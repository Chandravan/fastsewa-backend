import { Router } from "express"
import { handleCcavenueCallback } from "../controllers/paymentController.js"

export const paymentRouter = Router()

paymentRouter.post("/ccavenue/callback", handleCcavenueCallback)
