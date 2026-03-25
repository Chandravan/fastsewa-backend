import { Router } from "express"
import { auditRouter } from "./auditRoutes.js"
import { authRouter } from "./authRoutes.js"
import { dashboardRouter } from "./dashboardRoutes.js"
import { orderRouter } from "./orderRoutes.js"
import { paymentRouter } from "./paymentRoutes.js"
import { serviceRouter } from "./serviceRoutes.js"
import { userRouter } from "./userRoutes.js"

export const apiRouter = Router()

apiRouter.use("/auth", authRouter)
apiRouter.use("/audit-logs", auditRouter)
apiRouter.use("/services", serviceRouter)
apiRouter.use("/orders", orderRouter)
apiRouter.use("/payments", paymentRouter)
apiRouter.use("/dashboard", dashboardRouter)
apiRouter.use("/users", userRouter)
