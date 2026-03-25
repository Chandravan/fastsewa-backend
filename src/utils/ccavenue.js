import crypto from "crypto"
import { env } from "../config/env.js"

const IV = Buffer.from(Array.from({ length: 16 }, (_, index) => index))
const TEST_GATEWAY_URL = "https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction"
const LIVE_GATEWAY_URL = "https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction"

function getCipherKey(workingKey) {
  return crypto.createHash("md5").update(workingKey).digest()
}

function normalizeBaseUrl(url) {
  return url.replace(/\/$/, "")
}

function formatAmount(value) {
  return Number(value || 0).toFixed(2)
}

function sanitizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "")
  return digits || "9999999999"
}

function sanitizeText(value, fallback = "NA") {
  const normalized = String(value || "").trim()
  return normalized || fallback
}

export function isCcavenueConfigured() {
  return Boolean(
    env.ccavenueMerchantId &&
    env.ccavenueAccessCode &&
    env.ccavenueWorkingKey
  )
}

export function getCcavenueGatewayUrl() {
  return env.ccavenueMode.toLowerCase() === "production"
    ? LIVE_GATEWAY_URL
    : TEST_GATEWAY_URL
}

export function encryptCcavenuePayload(payload, workingKey = env.ccavenueWorkingKey) {
  const cipher = crypto.createCipheriv("aes-128-cbc", getCipherKey(workingKey), IV)
  return `${cipher.update(payload, "utf8", "hex")}${cipher.final("hex")}`
}

export function decryptCcavenuePayload(payload, workingKey = env.ccavenueWorkingKey) {
  const decipher = crypto.createDecipheriv("aes-128-cbc", getCipherKey(workingKey), IV)
  return `${decipher.update(payload, "hex", "utf8")}${decipher.final("utf8")}`
}

export function serializeCcavenueFields(fields) {
  const params = new URLSearchParams()

  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value))
    }
  })

  return params.toString()
}

export function parseCcavenueResponse(encResp) {
  const decrypted = decryptCcavenuePayload(encResp)
  return Object.fromEntries(new URLSearchParams(decrypted).entries())
}

export function getCcavenueCallbackUrl() {
  return `${normalizeBaseUrl(env.backendPublicUrl)}/api/payments/ccavenue/callback`
}

export function getCcavenueFrontendReturnUrl(path) {
  return new URL(path, normalizeBaseUrl(env.frontendUrl)).toString()
}

export function buildCcavenueRequest({ order, user }) {
  const callbackUrl = getCcavenueCallbackUrl()
  const billingName = sanitizeText(user.businessName || user.name, user.name)
  const requestFields = {
    merchant_id: env.ccavenueMerchantId,
    order_id: order.orderNumber,
    currency: order.payment?.currency || "INR",
    amount: formatAmount(order.pricing?.totalAmount),
    redirect_url: callbackUrl,
    cancel_url: callbackUrl,
    language: "EN",
    billing_name: billingName,
    billing_address: sanitizeText(user.address),
    billing_city: "NA",
    billing_state: "NA",
    billing_zip: "000000",
    billing_country: "India",
    billing_tel: sanitizePhone(user.phone),
    billing_email: user.email,
    merchant_param1: order.id,
    merchant_param2: user.id,
    merchant_param3: order.serviceSnapshot?.name || "",
    merchant_param4: order.pricing?.totalAmount || "",
  }

  const encRequest = encryptCcavenuePayload(serializeCcavenueFields(requestFields))

  return {
    gateway: "ccavenue",
    method: "POST",
    actionUrl: getCcavenueGatewayUrl(),
    fields: {
      encRequest,
      access_code: env.ccavenueAccessCode,
    },
    meta: {
      merchantOrderId: order.orderNumber,
      amount: requestFields.amount,
      currency: requestFields.currency,
      callbackUrl,
    },
  }
}

export function mapCcavenuePaymentState(orderStatus) {
  const normalizedStatus = String(orderStatus || "").trim().toLowerCase()

  if (normalizedStatus === "success") {
    return { paymentStatus: "paid", orderStatus: "processing", result: "success" }
  }

  if (["aborted", "failure", "failed", "invalid"].includes(normalizedStatus)) {
    return { paymentStatus: "failed", orderStatus: "pending", result: "failed" }
  }

  return { paymentStatus: "pending", orderStatus: "pending", result: "pending" }
}
