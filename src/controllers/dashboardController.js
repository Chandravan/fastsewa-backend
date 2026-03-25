import { dashboardReminders } from "../constants/dashboardReminders.js"
import { userHasAnyPermission } from "../constants/adminPermissions.js"
import { Order } from "../models/Order.js"
import { Service } from "../models/Service.js"
import { User } from "../models/User.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { mapOrderToClient } from "../utils/orderHelpers.js"

export const getOverview = asyncHandler(async (req, res) => {
  const query = req.user.role === "admin" && userHasAnyPermission(req.user, ["orders.view", "orders.manage", "orders.bulk"])
    ? {}
    : { user: req.user._id }

  const [orders, allOrders] = await Promise.all([
    Order.find(query).sort({ createdAt: -1 }).limit(5).populate("service"),
    Order.find(query),
  ])

  const stats = {
    totalOrders: allOrders.length,
    completedOrders: allOrders.filter((order) => order.status === "completed").length,
    pendingOrders: allOrders.filter((order) => order.status === "pending").length,
    processingOrders: allOrders.filter((order) => order.status === "processing").length,
    totalSpent: allOrders
      .filter((order) => order.paymentStatus === "paid")
      .reduce((sum, order) => sum + order.pricing.finalAmount, 0),
  }

  res.json({
    stats,
    recentOrders: orders.map(mapOrderToClient),
    reminders: dashboardReminders,
  })
})

function sumOrderValue(orders, predicate = () => true) {
  return orders
    .filter(predicate)
    .reduce((sum, order) => sum + (order.pricing?.totalAmount || 0), 0)
}

function buildAdminRecentOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    serviceName: order.serviceSnapshot?.name || "",
    category: order.serviceSnapshot?.category || "",
    status: order.status,
    paymentStatus: order.paymentStatus,
    amount: order.pricing?.totalAmount || 0,
    createdAt: order.createdAt,
    clientName: order.user?.businessName || order.user?.name || "Unknown client",
    clientEmail: order.user?.email || "",
  }
}

export const getAdminOverview = asyncHandler(async (req, res) => {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [recentOrders, allOrders, totalClients, newClientsThisMonth, activeServices] = await Promise.all([
    Order.find({})
      .sort({ createdAt: -1 })
      .limit(7)
      .populate("user"),
    Order.find({}),
    User.countDocuments({ role: "client" }),
    User.countDocuments({ role: "client", joinedAt: { $gte: startOfMonth } }),
    Service.countDocuments({ active: true }),
  ])

  const billedRevenue = sumOrderValue(allOrders)
  const collectedRevenue = sumOrderValue(allOrders, (order) => order.paymentStatus === "paid")
  const pendingRevenue = sumOrderValue(allOrders, (order) => order.paymentStatus !== "paid")

  const paymentBreakdown = {
    paid: allOrders.filter((order) => order.paymentStatus === "paid").length,
    pending: allOrders.filter((order) => order.paymentStatus === "pending").length,
    failed: allOrders.filter((order) => order.paymentStatus === "failed").length,
  }

  const orderBreakdown = {
    completed: allOrders.filter((order) => order.status === "completed").length,
    processing: allOrders.filter((order) => order.status === "processing").length,
    pending: allOrders.filter((order) => order.status === "pending").length,
    cancelled: allOrders.filter((order) => order.status === "cancelled").length,
  }

  const activeClientIds = new Set(
    allOrders
      .filter((order) => new Date(order.createdAt) >= thirtyDaysAgo)
      .map((order) => order.user?.toString())
      .filter(Boolean)
  )

  const servicePerformance = new Map()
  for (const order of allOrders) {
    const key = order.serviceSnapshot?.name || "Unknown service"
    const current = servicePerformance.get(key) || {
      serviceName: key,
      category: order.serviceSnapshot?.category || "",
      orders: 0,
      revenue: 0,
    }

    current.orders += 1
    current.revenue += order.pricing?.totalAmount || 0
    servicePerformance.set(key, current)
  }

  const topServices = Array.from(servicePerformance.values())
    .sort((left, right) => right.orders - left.orders || right.revenue - left.revenue)
    .slice(0, 5)

  res.json({
    stats: {
      totalOrders: allOrders.length,
      completedOrders: orderBreakdown.completed,
      processingOrders: orderBreakdown.processing,
      pendingOrders: orderBreakdown.pending,
      cancelledOrders: orderBreakdown.cancelled,
      billedRevenue,
      collectedRevenue,
      pendingRevenue,
      totalClients,
      activeClients: activeClientIds.size,
      newClientsThisMonth,
      activeServices,
      collectionRate: billedRevenue > 0 ? Math.round((collectedRevenue / billedRevenue) * 100) : 0,
      averageTicketSize: allOrders.length > 0 ? Math.round(billedRevenue / allOrders.length) : 0,
    },
    queue: [
      { id: "pending", label: "Pending approvals", value: orderBreakdown.pending, tone: "amber" },
      { id: "processing", label: "In progress", value: orderBreakdown.processing, tone: "orange" },
      { id: "completed", label: "Completed", value: orderBreakdown.completed, tone: "green" },
      { id: "payments", label: "Payment issues", value: paymentBreakdown.failed, tone: "red" },
    ],
    paymentBreakdown,
    topServices,
    recentOrders: recentOrders.map(buildAdminRecentOrder),
    reminders: dashboardReminders.slice(0, 4),
  })
})
