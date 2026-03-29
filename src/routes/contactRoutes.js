import { Router } from "express"
import {
  listContactInquiriesAdmin,
  submitContactInquiry,
  updateContactInquiryAdmin,
} from "../controllers/contactController.js"
import { requireAuth, requirePermission } from "../middlewares/auth.js"

export const contactRouter = Router()

contactRouter.post("/", submitContactInquiry)
contactRouter.get("/admin/inquiries", requireAuth, requirePermission("inquiries.view", "inquiries.manage"), listContactInquiriesAdmin)
contactRouter.put("/admin/inquiries/:inquiryId", requireAuth, requirePermission("inquiries.manage"), updateContactInquiryAdmin)
