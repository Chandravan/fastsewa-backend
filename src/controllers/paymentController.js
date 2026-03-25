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

  order.payment = {
    ...(order.payment || {}),
    gateway: "ccavenue",
    merchantOrderId: order.orderNumber,
    currency: order.payment?.currency || "INR",
    initiatedAt: new Date(),
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
      $or: buildOrderLookupQuery(orderIdentifier),
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

    const paymentState = mapCcavenuePaymentState(response.order_status)
    const effectivePaymentState = order.paymentStatus === "paid" && paymentState.result !== "success"
      ? {
          paymentStatus: "paid",
          orderStatus: order.status,
          result: "success",
        }
      : paymentState

    const previousPaymentStatus = order.paymentStatus
    order.paymentStatus = effectivePaymentState.paymentStatus

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
      merchantOrderId: response.order_id || order.orderNumber,
      gatewayStatus: response.order_status || "",
      trackingId: response.tracking_id || "",
      bankRefNo: response.bank_ref_no || "",
      paymentMode: response.payment_mode || "",
      cardName: response.card_name || "",
      currency: response.currency || order.payment?.currency || "INR",
      initiatedAt: order.payment?.initiatedAt || new Date(),
      completedAt: effectivePaymentState.result === "success" ? new Date() : order.payment?.completedAt || null,
      statusMessage: response.status_message || response.failure_message || "",
      rawResponse: response,
    }

    await order.save()

    if (previousPaymentStatus !== "paid" && order.paymentStatus === "paid") {
      queueNotification("payment-success-ccavenue-callback", () => sendPaymentSuccessNotifications({ order }))
    }

    return res.redirect(303, buildReturnUrl({
      order,
      result: effectivePaymentState.result,
      message: response.status_message || response.failure_message || response.order_status || "",
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
