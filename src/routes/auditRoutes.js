import { Router } from "express"
import { listAuditLogs } from "../controllers/auditController.js"
import { requireAuth, requirePermission } from "../middlewares/auth.js"

export const auditRouter = Router()

auditRouter.use(requireAuth)
auditRouter.get("/", requirePermission("audit.view"), listAuditLogs)
