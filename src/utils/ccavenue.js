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

function toMinorAmount(value) {
  const normalized = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim())
  return Number.isFinite(normalized) ? Math.round(normalized * 100) : null
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
  const gatewayOrderId = order.payment?.attemptId || order.orderNumber
  const requestFields = {
    merchant_id: env.ccavenueMerchantId,
    order_id: gatewayOrderId,
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
    merchant_param5: order.payment?.attemptId || "",
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
      merchantOrderId: gatewayOrderId,
      attemptId: order.payment?.attemptId || "",
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

  return { paymentStatus: "verification_pending", orderStatus: "pending", result: "pending" }
}

export function getCcavenuePaymentVerificationIssue({ response, order }) {
  const expectedGatewayOrderId = String(order.payment?.attemptId || order.payment?.merchantOrderId || order.orderNumber || "").trim()
  const returnedGatewayOrderId = String(response.order_id || "").trim()

  if (!returnedGatewayOrderId) {
    return "CCAvenue did not return a gateway order id."
  }

  if (expectedGatewayOrderId && returnedGatewayOrderId !== expectedGatewayOrderId) {
    return "CCAvenue gateway order id does not match this order."
  }

  const expectedAttemptId = String(order.payment?.attemptId || "").trim()
  const returnedAttemptId = String(response.merchant_param5 || "").trim()
  if (expectedAttemptId && returnedAttemptId && returnedAttemptId !== expectedAttemptId) {
    return "CCAvenue payment attempt id does not match this order."
  }

  const expectedUserId = String(order.user?._id || order.user?.id || order.user || "").trim()
  const returnedUserId = String(response.merchant_param2 || "").trim()
  if (expectedUserId && returnedUserId && returnedUserId !== expectedUserId) {
    return "CCAvenue client id does not match this order."
  }

  const expectedAmount = toMinorAmount(order.pricing?.totalAmount)
  const returnedAmount = toMinorAmount(response.amount)
  if (!expectedAmount || returnedAmount === null) {
    return "CCAvenue payment amount could not be verified."
  }

  if (Math.abs(returnedAmount - expectedAmount) > 1) {
    return "CCAvenue payment amount does not match the order total."
  }

  const expectedCurrency = String(order.payment?.currency || "INR").trim().toUpperCase()
  const returnedCurrency = String(response.currency || "").trim().toUpperCase()
  if (!returnedCurrency) {
    return "CCAvenue payment currency could not be verified."
  }

  if (returnedCurrency !== expectedCurrency) {
    return "CCAvenue payment currency does not match this order."
  }

  return ""
}
