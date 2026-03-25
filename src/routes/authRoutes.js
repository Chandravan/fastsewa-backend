import { Router } from "express"
import {
  changePassword,
  forgotPassword,
  getMe,
  login,
  register,
  resetPassword,
} from "../controllers/authController.js"
import { requireAuth } from "../middlewares/auth.js"

export const authRouter = Router()

authRouter.post("/register", register)
authRouter.post("/login", login)
authRouter.post("/forgot-password", forgotPassword)
authRouter.post("/reset-password", resetPassword)
authRouter.post("/change-password", requireAuth, changePassword)
authRouter.get("/me", requireAuth, getMe)
