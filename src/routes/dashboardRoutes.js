import { Router } from "express"
import { getAdminOverview, getOverview } from "../controllers/dashboardController.js"
import { requireAuth, requirePermission } from "../middlewares/auth.js"

export const dashboardRouter = Router()

dashboardRouter.use(requireAuth)
dashboardRouter.get("/overview", getOverview)
dashboardRouter.get("/admin-overview", requirePermission("dashboard.view"), getAdminOverview)
