import { Router } from "express"
import {
  bulkServiceAction,
  archiveService,
  createService,
  getService,
  listAdminServices,
  listServices,
  restoreService,
  updateService,
} from "../controllers/serviceController.js"
import { requireAuth, requirePermission } from "../middlewares/auth.js"

export const serviceRouter = Router()

serviceRouter.get("/", listServices)
serviceRouter.get("/admin/catalog", requireAuth, requirePermission("services.view"), listAdminServices)
serviceRouter.post("/bulk", requireAuth, requirePermission("services.bulk"), bulkServiceAction)
serviceRouter.post("/", requireAuth, requirePermission("services.manage"), createService)
serviceRouter.post("/:serviceId/restore", requireAuth, requirePermission("services.restore"), restoreService)
serviceRouter.put("/:serviceId", requireAuth, requirePermission("services.manage"), updateService)
serviceRouter.delete("/:serviceId", requireAuth, requirePermission("services.archive"), archiveService)
serviceRouter.get("/:serviceId", getService)
