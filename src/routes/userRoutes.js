import { Router } from "express"
import {
  bulkUserActionAdmin,
  createUserAdmin,
  deleteUserAdmin,
  getProfile,
  listUsersAdmin,
  setUserStatusAdmin,
  updateProfile,
  updateUserAdmin,
} from "../controllers/userController.js"
import { requireAuth, requirePermission } from "../middlewares/auth.js"

export const userRouter = Router()

userRouter.use(requireAuth)
userRouter.get("/", requirePermission("users.view"), listUsersAdmin)
userRouter.post("/bulk", requirePermission("users.bulk"), bulkUserActionAdmin)
userRouter.post("/", requirePermission("users.manage"), createUserAdmin)
userRouter.get("/profile", getProfile)
userRouter.put("/profile", updateProfile)
userRouter.put("/:userId/status", requirePermission("users.disable"), setUserStatusAdmin)
userRouter.put("/:userId", requirePermission("users.manage"), updateUserAdmin)
userRouter.delete("/:userId", requirePermission("users.delete"), deleteUserAdmin)
