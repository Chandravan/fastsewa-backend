import { Router } from "express"
import {
  addOrderDocument,
  bulkUpdateOrdersAdmin,
  createOrder,
  getOrder,
  listOrders,
  updateOrderAdmin,
} from "../controllers/orderController.js"
import { initiateCcavenuePayment } from "../controllers/paymentController.js"
import { requireAuth, requirePermission } from "../middlewares/auth.js"

export const orderRouter = Router()

orderRouter.use(requireAuth)
orderRouter.get("/", listOrders)
orderRouter.post("/", createOrder)
orderRouter.post("/bulk/admin", requirePermission("orders.bulk"), bulkUpdateOrdersAdmin)
orderRouter.get("/:orderId", getOrder)
orderRouter.put("/:orderId/admin", requirePermission("orders.manage"), updateOrderAdmin)
orderRouter.post("/:orderId/documents", addOrderDocument)
orderRouter.post("/:orderId/payments/ccavenue/initiate", initiateCcavenuePayment)
