import { User } from "../models/User.js"
import { userHasAnyPermission } from "../constants/adminPermissions.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { verifyToken } from "../utils/jwt.js"

export const requireAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || ""
  const [scheme, token] = authHeader.split(" ")

  if (scheme !== "Bearer" || !token) {
    throw new ApiError(401, "Authentication required")
  }

  let payload
  try {
    payload = verifyToken(token)
  } catch {
    throw new ApiError(401, "Invalid or expired token")
  }

  const user = await User.findById(payload.userId)
  if (!user) {
    throw new ApiError(401, "User not found")
  }

  if (user.active === false) {
    throw new ApiError(403, "This account has been disabled. Please contact an administrator.")
  }

  if (typeof user.changedPasswordAfter === "function" && user.changedPasswordAfter(payload.iat)) {
    throw new ApiError(401, "Your session has expired after a password change. Please sign in again.")
  }

  req.user = user
  next()
})

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, "You do not have access to this resource"))
    }
    next()
  }
}

export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== "admin") {
      return next(new ApiError(403, "You do not have access to this resource"))
    }

    if (!userHasAnyPermission(req.user, permissions)) {
      return next(new ApiError(403, "You do not have permission to perform this action"))
    }

    next()
  }
}
