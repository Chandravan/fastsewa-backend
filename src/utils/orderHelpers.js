import mongoose from "mongoose"
import { userHasAnyPermission } from "../constants/adminPermissions.js"
import { ApiError } from "./ApiError.js"

export function buildPricing(service) {
  const discountPercent = service.discountPercent || 0
  const baseAmount = service.basePrice
  const discountAmount = Math.round(baseAmount * (discountPercent / 100))
  const finalAmount = Math.max(0, baseAmount - discountAmount)
  const gstRate = 18
  const gstAmount = Math.round(finalAmount * (gstRate / 100))
  const totalAmount = finalAmount + gstAmount

  return {
    baseAmount,
    discountPercent,
    discountAmount,
    finalAmount,
    gstRate,
    gstAmount,
    totalAmount,
  }
}

export function createInitialTimeline(hasDocuments = false) {
  const now = new Date()

  return [
    { status: "Order placed", date: now, done: true },
    { status: "Payment received", date: null, done: false },
    { status: "Documents uploaded", date: hasDocuments ? now : null, done: hasDocuments },
    { status: "Processing started", date: null, done: false },
    { status: "Completed", date: null, done: false },
  ]
}

export function markTimelineStep(timeline, stepStatus, date = new Date()) {
  return timeline.map((step) => (
    step.status === stepStatus
      ? { ...step, done: true, date }
      : step
  ))
}

export function mapOrderToClient(orderDoc) {
  const order = typeof orderDoc.toJSON === "function" ? orderDoc.toJSON() : orderDoc
  const attemptExpiresAt = order.payment?.attemptExpiresAt ? new Date(order.payment.attemptExpiresAt) : null
  const paymentStatus = order.paymentStatus === "pending"
    && order.payment?.attemptStatus === "initiated"
    && attemptExpiresAt
    && attemptExpiresAt.getTime() <= Date.now()
      ? "verification_pending"
      : order.paymentStatus

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    serviceId: order.service?.code || order.serviceSnapshot?.code || null,
    serviceName: order.serviceSnapshot?.name || "",
    category: order.serviceSnapshot?.category || "",
    status: order.status,
    paymentStatus,
    amount: order.pricing?.finalAmount || 0,
    pricing: order.pricing,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    assignedTo: order.assignedTo,
    clientName: order.user?.businessName || order.user?.name || "",
    clientEmail: order.user?.email || "",
    notes: order.notes,
    timeline: order.timeline,
    documents: order.documents,
    payment: order.payment || null,
  }
}

export async function generateOrderNumber(OrderModel) {
  const year = new Date().getFullYear()
  const prefix = `ORD-${year}-`

  const existingCount = await OrderModel.countDocuments({
    orderNumber: new RegExp(`^${prefix}`),
  })

  return `${prefix}${String(existingCount + 1).padStart(4, "0")}`
}

export function buildServiceLookupQuery(identifier) {
  const query = [{ code: identifier }, { slug: identifier }]

  if (mongoose.Types.ObjectId.isValid(identifier)) {
    query.push({ _id: identifier })
  }

  return query
}

export function buildOrderLookupQuery(identifier) {
  const query = [{ orderNumber: identifier }]

  if (mongoose.Types.ObjectId.isValid(identifier)) {
    query.push({ _id: identifier })
  }

  return query
}

export function ensureOwnedResource(resource, reqUser) {
  if (reqUser.role === "admin" && userHasAnyPermission(reqUser, ["orders.view", "orders.manage", "orders.bulk"])) {
    return
  }

  const ownerId = resource.user?._id?.toString?.() || resource.user?.toString?.()
  if (ownerId !== reqUser.id) {
    throw new ApiError(403, "You do not have access to this order")
  }
}
