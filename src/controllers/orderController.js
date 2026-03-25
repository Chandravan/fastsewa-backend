import { userHasAnyPermission } from "../constants/adminPermissions.js"
import { Order } from "../models/Order.js"
import { Service } from "../models/Service.js"
import { createAuditLog } from "../services/auditService.js"
import {
  queueNotification,
  sendOrderCreatedNotifications,
  sendOrderUpdateNotifications,
  sendPaymentSuccessNotifications,
} from "../services/notificationService.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import {
  buildOrderLookupQuery,
  buildPricing,
  buildServiceLookupQuery,
  createInitialTimeline,
  ensureOwnedResource,
  generateOrderNumber,
  mapOrderToClient,
  markTimelineStep,
} from "../utils/orderHelpers.js"

async function findOrderOrThrow(identifier) {
  const order = await Order.findOne({
    $or: buildOrderLookupQuery(identifier),
  }).populate("service").populate("user", "name email businessName")

  if (!order) {
    throw new ApiError(404, "Order not found")
  }

  return order
}

function captureOrderState(order) {
  return {
    status: order.status,
    paymentStatus: order.paymentStatus,
    assignedTo: order.assignedTo || "",
    notes: order.notes || "",
  }
}

function summarizeOrderChanges(previousState, order) {
  const changes = []

  if (previousState.status !== order.status) {
    changes.push(`status ${previousState.status} -> ${order.status}`)
  }

  if (previousState.paymentStatus !== order.paymentStatus) {
    changes.push(`payment ${previousState.paymentStatus} -> ${order.paymentStatus}`)
  }

  if ((previousState.assignedTo || "") !== (order.assignedTo || "")) {
    changes.push(`assignee ${(previousState.assignedTo || "unassigned")} -> ${(order.assignedTo || "unassigned")}`)
  }

  if ((previousState.notes || "").trim() !== (order.notes || "").trim() && order.notes) {
    changes.push("client note updated")
  }

  return changes
}

function applyAdminOrderUpdate(order, payload) {
  const previousState = captureOrderState(order)
  const {
    status,
    paymentStatus,
    assignedTo,
    notes,
  } = payload

  if (status !== undefined) {
    order.status = status
  }

  if (paymentStatus !== undefined) {
    order.paymentStatus = paymentStatus
  }

  if (assignedTo !== undefined) {
    order.assignedTo = assignedTo || null
  }

  if (notes !== undefined) {
    order.notes = notes
  }

  if (order.paymentStatus === "paid") {
    order.timeline = markTimelineStep(order.timeline, "Payment received")
    order.payment = {
      ...(order.payment || {}),
      completedAt: order.payment?.completedAt || new Date(),
    }

    if (order.status === "pending") {
      order.status = "processing"
    }

    if (!order.assignedTo) {
      order.assignedTo = "FastSewa CA Team"
    }
  }

  if (order.status === "processing" || order.status === "completed") {
    order.timeline = markTimelineStep(order.timeline, "Processing started")
  }

  if (order.status === "completed") {
    order.timeline = markTimelineStep(order.timeline, "Completed")
  }

  return {
    previousState,
    paymentJustCompleted: previousState.paymentStatus !== "paid" && order.paymentStatus === "paid",
  }
}

function buildBulkOrderLookupQuery(ids = []) {
  return ids.flatMap((identifier) => buildOrderLookupQuery(identifier))
}

function canViewAllOrders(user) {
  return user.role === "admin" && userHasAnyPermission(user, ["orders.view", "orders.manage", "orders.bulk"])
}

async function queueOrderAdminNotifications(order, previousState, paymentJustCompleted) {
  if (paymentJustCompleted) {
    queueNotification("payment-success-admin-update", () => sendPaymentSuccessNotifications({ order }))
  }

  queueNotification("order-updated-admin", () => sendOrderUpdateNotifications({
    order,
    previousState,
  }))
}

export const createOrder = asyncHandler(async (req, res) => {
  const { serviceId, notes = "", documents = [] } = req.body

  if (!serviceId) {
    throw new ApiError(400, "serviceId is required")
  }

  const service = await Service.findOne({
    $or: buildServiceLookupQuery(serviceId),
    active: true,
  })

  if (!service) {
    throw new ApiError(404, "Selected service does not exist")
  }

  const normalizedDocuments = Array.isArray(documents)
    ? documents
        .filter((item) => item?.name)
        .map((item) => ({ name: item.name, url: item.url || "" }))
    : []

  const order = await Order.create({
    orderNumber: await generateOrderNumber(Order),
    user: req.user._id,
    service: service._id,
    serviceSnapshot: {
      code: service.code,
      category: service.category,
      name: service.name,
      description: service.description,
      duration: service.duration,
    },
    pricing: buildPricing(service),
    notes,
    documents: normalizedDocuments,
    timeline: createInitialTimeline(normalizedDocuments.length > 0),
  })

  const populatedOrder = await Order.findById(order._id)
    .populate("service")
    .populate("user", "name email businessName")

  queueNotification("order-created-notifications", () => sendOrderCreatedNotifications({
    order: populatedOrder,
    user: req.user,
  }))
  await createAuditLog({
    req,
    action: "order.create",
    entityType: "order",
    entityId: populatedOrder.id,
    entityLabel: populatedOrder.orderNumber,
    summary: `Created order ${populatedOrder.orderNumber}`,
    metadata: {
      service: populatedOrder.serviceSnapshot?.name || "",
      amount: populatedOrder.pricing?.totalAmount || 0,
    },
  })

  res.status(201).json({
    message: "Order created successfully",
    order: mapOrderToClient(populatedOrder),
  })
})

export const listOrders = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const query = {}

  if (!canViewAllOrders(req.user)) {
    query.user = req.user._id
  }

  if (status && status !== "All") {
    query.status = status
  }

  if (search) {
    query.$or = [
      { orderNumber: { $regex: search, $options: "i" } },
      { "serviceSnapshot.name": { $regex: search, $options: "i" } },
      { "serviceSnapshot.category": { $regex: search, $options: "i" } },
    ]
  }

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .populate("service")
    .populate("user", "name email businessName")

  res.json({
    items: orders.map(mapOrderToClient),
  })
})

export const getOrder = asyncHandler(async (req, res) => {
  const order = await findOrderOrThrow(req.params.orderId)
  ensureOwnedResource(order, req.user)

  res.json({
    order: mapOrderToClient(order),
  })
})

export const addOrderDocument = asyncHandler(async (req, res) => {
  const { name, url = "" } = req.body
  if (!name) {
    throw new ApiError(400, "Document name is required")
  }

  const order = await findOrderOrThrow(req.params.orderId)
  ensureOwnedResource(order, req.user)

  order.documents.push({ name, url })
  order.timeline = markTimelineStep(order.timeline, "Documents uploaded")
  await order.save()

  res.json({
    message: "Document metadata added",
    order: mapOrderToClient(order),
  })
})

export const updateOrderAdmin = asyncHandler(async (req, res) => {
  const order = await findOrderOrThrow(req.params.orderId)
  const { previousState, paymentJustCompleted } = applyAdminOrderUpdate(order, req.body)
  await order.save()

  await queueOrderAdminNotifications(order, previousState, paymentJustCompleted)
  await createAuditLog({
    req,
    action: "order.update",
    entityType: "order",
    entityId: order.id,
    entityLabel: order.orderNumber,
    summary: `Updated order ${order.orderNumber}`,
    metadata: {
      changes: summarizeOrderChanges(previousState, order),
      status: order.status,
      paymentStatus: order.paymentStatus,
      assignedTo: order.assignedTo || null,
    },
  })

  res.json({
    message: "Order updated successfully",
    order: mapOrderToClient(order),
  })
})

export const bulkUpdateOrdersAdmin = asyncHandler(async (req, res) => {
  const { ids = [] } = req.body

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "Select at least one order")
  }

  const hasUpdatePayload = ["status", "paymentStatus", "assignedTo", "notes"].some((field) => req.body[field] !== undefined)
  if (!hasUpdatePayload) {
    throw new ApiError(400, "Provide at least one field to update")
  }

  const orders = await Order.find({
    $or: buildBulkOrderLookupQuery(ids),
  })
    .populate("service")
    .populate("user", "name email businessName")

  if (orders.length === 0) {
    throw new ApiError(404, "No matching orders found for the bulk action")
  }

  const updatedOrders = []
  for (const order of orders) {
    const { previousState, paymentJustCompleted } = applyAdminOrderUpdate(order, req.body)
    await order.save()
    await queueOrderAdminNotifications(order, previousState, paymentJustCompleted)
    updatedOrders.push({
      order,
      changes: summarizeOrderChanges(previousState, order),
    })
  }

  await createAuditLog({
    req,
    action: "order.bulk.update",
    entityType: "order",
    summary: `Applied bulk update to ${updatedOrders.length} order${updatedOrders.length === 1 ? "" : "s"}`,
    metadata: {
      ids: updatedOrders.map((item) => item.order.id),
      orderNumbers: updatedOrders.map((item) => item.order.orderNumber),
      changes: updatedOrders.map((item) => ({
        orderNumber: item.order.orderNumber,
        changes: item.changes,
      })),
    },
  })

  res.json({
    message: `Updated ${updatedOrders.length} order${updatedOrders.length === 1 ? "" : "s"} successfully`,
    items: updatedOrders.map((item) => mapOrderToClient(item.order)),
    count: updatedOrders.length,
  })
})
