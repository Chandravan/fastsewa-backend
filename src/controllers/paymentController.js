import { env } from "../config/env.js"
import { Order } from "../models/Order.js"
import {
  queueNotification,
  sendPaymentSuccessNotifications,
} from "../services/notificationService.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import {
  buildCcavenueRequest,
  getCcavenueFrontendReturnUrl,
  getCcavenuePaymentVerificationIssue,
  isCcavenueConfigured,
  mapCcavenuePaymentState,
  parseCcavenueResponse,
} from "../utils/ccavenue.js"
import {
  buildOrderLookupQuery,
  ensureOwnedResource,
  mapOrderToClient,
  markTimelineStep,
} from "../utils/orderHelpers.js"

const PAYMENT_ATTEMPT_TTL_MS = 20 * 60 * 1000

async function findOrderOrThrow(identifier) {
  const order = await Order.findOne({
    $or: buildOrderLookupQuery(identifier),
  })
    .populate("service")
    .populate("user", "name email businessName")

  if (!order) {
    throw new ApiError(404, "Order not found")
  }

  return order
}

function createPaymentAttemptId(order, now = new Date()) {
  const prefix = String(order.orderNumber || order.id || "ORDER").replace(/[^a-zA-Z0-9]/g, "")
  return `${prefix}${now.getTime()}`
}

function isAttemptActive(payment = {}, now = new Date()) {
  if (payment.attemptStatus !== "initiated" || !payment.attemptExpiresAt) {
    return false
  }

  return new Date(payment.attemptExpiresAt).getTime() > now.getTime()
}

function isAttemptExpired(payment = {}, now = new Date()) {
  if (payment.attemptStatus !== "initiated" || !payment.attemptExpiresAt) {
    return false
  }

  return new Date(payment.attemptExpiresAt).getTime() <= now.getTime()
}

function buildPaymentLookupQuery(identifiers = []) {
  const uniqueIdentifiers = Array.from(new Set(identifiers.filter(Boolean).map(String)))
  return uniqueIdentifiers.flatMap((identifier) => [
    ...buildOrderLookupQuery(identifier),
    { "payment.attemptId": identifier },
    { "payment.merchantOrderId": identifier },
  ])
}

function buildReturnUrl({ order, result, message = "" }) {
  const path = order
    ? `/dashboard/orders/${order.id}`
    : "/dashboard/orders"
  const url = new URL(getCcavenueFrontendReturnUrl(path))

  url.searchParams.set("payment", result)
  if (message) {
    url.searchParams.set("message", message)
  }

  return url.toString()
}

export const initiateCcavenuePayment = asyncHandler(async (req, res) => {
  if (!isCcavenueConfigured()) {
    throw new ApiError(503, "CCAvenue configuration is missing on the backend")
  }

  const order = await findOrderOrThrow(req.params.orderId)
  ensureOwnedResource(order, req.user)

  if (order.paymentStatus === "paid") {
    throw new ApiError(400, "This order is already paid")
  }

  if (order.paymentStatus === "refunded") {
    throw new ApiError(400, "This order has already been refunded. Please create a new order if payment is needed again.")
  }

  const now = new Date()
  if (isAttemptActive(order.payment, now)) {
    throw new ApiError(409, "Payment is already in progress. Please wait for CCAvenue to return the confirmation before retrying.")
  }

  if (order.paymentStatus === "verification_pending" || isAttemptExpired(order.payment, now)) {
    order.paymentStatus = "verification_pending"
    order.payment = {
      ...(order.payment || {}),
      attemptStatus: "verification_pending",
      statusMessage: "Payment attempt is awaiting manual verification. Please contact support before retrying.",
    }
    await order.save()
    throw new ApiError(409, "This payment is awaiting verification. Please contact support before retrying.")
  }

  const attemptId = createPaymentAttemptId(order, now)
  order.payment = {
    ...(order.payment || {}),
    gateway: "ccavenue",
    merchantOrderId: attemptId,
    attemptId,
    attemptStatus: "initiated",
    currency: order.payment?.currency || "INR",
    initiatedAt: now,
    attemptStartedAt: now,
    attemptExpiresAt: new Date(now.getTime() + PAYMENT_ATTEMPT_TTL_MS),
    lastCallbackAt: null,
    statusMessage: "Payment initiated. Awaiting CCAvenue confirmation.",
  }
  await order.save()

  res.json({
    message: "CCAvenue payment initialized",
    payment: buildCcavenueRequest({ order, user: req.user }),
    order: mapOrderToClient(order),
  })
})

export async function handleCcavenueCallback(req, res) {
  let order = null

  try {
    if (!isCcavenueConfigured()) {
      throw new ApiError(503, "CCAvenue configuration is missing on the backend")
    }

    const encResp = req.body?.encResp
    if (!encResp) {
      throw new ApiError(400, "CCAvenue response payload is missing")
    }

    const response = parseCcavenueResponse(encResp)
    const orderIdentifier = response.order_id || response.merchant_param1 || req.body?.orderNo
    if (!orderIdentifier) {
      throw new ApiError(400, "CCAvenue response did not include an order identifier")
    }

    order = await Order.findOne({
      $or: buildPaymentLookupQuery([
        response.order_id,
        response.merchant_param1,
        response.merchant_param5,
        req.body?.orderNo,
      ]),
    })
      .populate("service")
      .populate("user", "name email businessName")

    if (!order && response.merchant_param1) {
      order = await Order.findById(response.merchant_param1)
        .populate("service")
        .populate("user", "name email businessName")
    }

    if (!order) {
      throw new ApiError(404, "Unable to map the CCAvenue response to an order")
    }

    if (response.merchant_param1 && response.merchant_param1 !== order.id) {
      throw new ApiError(400, "CCAvenue response order ownership mismatch")
    }

    const previousPaymentStatus = order.paymentStatus
    const paymentState = mapCcavenuePaymentState(response.order_status)
    const verificationIssue = paymentState.result === "success" && previousPaymentStatus !== "paid"
      ? getCcavenuePaymentVerificationIssue({ response, order })
      : ""
    const effectivePaymentState = previousPaymentStatus === "paid"
      ? {
          paymentStatus: "paid",
          orderStatus: order.status,
          result: "success",
        }
      : verificationIssue
        ? {
            paymentStatus: "verification_pending",
            orderStatus: "pending",
            result: "pending",
          }
        : paymentState

    order.paymentStatus = effectivePaymentState.paymentStatus
    const callbackAt = new Date()
    const nextAttemptStatus = effectivePaymentState.result === "success"
      ? "success"
      : effectivePaymentState.result === "failed"
        ? "failed"
        : "verification_pending"

    if (effectivePaymentState.result === "success") {
      order.status = order.status === "completed" ? "completed" : effectivePaymentState.orderStatus
      if (!order.assignedTo) {
        order.assignedTo = "FastSewa CA Team"
      }
      order.timeline = markTimelineStep(order.timeline, "Payment received")
      order.timeline = markTimelineStep(order.timeline, "Processing started")
    } else if (order.status !== "completed") {
      order.status = effectivePaymentState.orderStatus
    }

    order.payment = {
      ...(order.payment || {}),
      gateway: "ccavenue",
      merchantOrderId: response.order_id || order.payment?.merchantOrderId || order.orderNumber,
      attemptId: order.payment?.attemptId || response.merchant_param5 || "",
      attemptStatus: nextAttemptStatus,
      gatewayStatus: response.order_status || "",
      trackingId: response.tracking_id || "",
      bankRefNo: response.bank_ref_no || "",
      paymentMode: response.payment_mode || "",
      cardName: response.card_name || "",
      currency: response.currency || order.payment?.currency || "INR",
      initiatedAt: order.payment?.initiatedAt || new Date(),
      lastCallbackAt: callbackAt,
      completedAt: effectivePaymentState.result === "success" ? callbackAt : order.payment?.completedAt || null,
      statusMessage: verificationIssue || response.status_message || response.failure_message || "",
      rawResponse: response,
    }

    await order.save()

    if (previousPaymentStatus !== "paid" && order.paymentStatus === "paid") {
      queueNotification("payment-success-ccavenue-callback", () => sendPaymentSuccessNotifications({ order }))
    }

    return res.redirect(303, buildReturnUrl({
      order,
      result: effectivePaymentState.result,
      message: verificationIssue || response.status_message || response.failure_message || response.order_status || "",
    }))
  } catch (error) {
    const safeMessage = error instanceof ApiError
      ? error.message
      : "We could not verify the CCAvenue payment response"

    return res.redirect(303, buildReturnUrl({
      order,
      result: "failed",
      message: env.nodeEnv === "production" ? "Payment verification failed" : safeMessage,
    }))
  }
}
