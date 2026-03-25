import crypto from "crypto"
import { env } from "../config/env.js"
import { createAuditLog } from "../services/auditService.js"
import { User } from "../models/User.js"
import {
  queueNotification,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "../services/notificationService.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { signToken } from "../utils/jwt.js"

function buildAuthResponse(user) {
  return {
    token: signToken({ userId: user.id, role: user.role }),
    user: user.toJSON(),
  }
}

function createPasswordResetToken() {
  const token = crypto.randomBytes(32).toString("hex")
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
  const expiresAt = new Date(Date.now() + env.passwordResetTokenTtlMinutes * 60 * 1000)

  return {
    token,
    tokenHash,
    expiresAt,
  }
}

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone = "", businessName = "" } = req.body

  if (!name || !email || !password) {
    throw new ApiError(400, "Name, email, and password are required")
  }

  if (password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters long")
  }

  const existingUser = await User.findOne({ email: email.toLowerCase() })
  if (existingUser) {
    throw new ApiError(409, "An account with this email already exists")
  }

  const user = await User.create({
    name,
    email,
    password,
    phone,
    businessName,
  })

  queueNotification("welcome-email-register", () => sendWelcomeEmail({ user }))
  await createAuditLog({
    req,
    action: "auth.register",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
    summary: `Registered new account ${user.email}`,
  })

  res.status(201).json(buildAuthResponse(user))
})

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required")
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select("+password")
  if (!user) {
    throw new ApiError(401, "Invalid email or password")
  }

  if (user.active === false) {
    throw new ApiError(403, "This account has been disabled. Please contact an administrator.")
  }

  const isPasswordValid = await user.comparePassword(password)
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid email or password")
  }

  await createAuditLog({
    req,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
    summary: `Signed in as ${user.email}`,
  })

  res.json(buildAuthResponse(user))
})

export const getMe = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toJSON() })
})

export const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim()
  if (!email) {
    throw new ApiError(400, "Email is required")
  }

  const user = await User.findOne({ email })
  let previewResetUrl = null

  if (user && user.active !== false) {
    const resetPayload = createPasswordResetToken()
    user.resetPasswordTokenHash = resetPayload.tokenHash
    user.resetPasswordExpiresAt = resetPayload.expiresAt
    await user.save()

    queueNotification("password-reset-email", async () => {
      const result = await sendPasswordResetEmail({
        user,
        resetToken: resetPayload.token,
      })

      if (env.nodeEnv !== "production" && result?.resetUrl) {
        console.info(`[auth] password reset preview URL for ${user.email}: ${result.resetUrl}`)
      }
    })

    if (env.nodeEnv !== "production") {
      previewResetUrl = new URL("/reset-password", env.frontendUrl).toString()
      const url = new URL(previewResetUrl)
      url.searchParams.set("token", resetPayload.token)
      previewResetUrl = url.toString()
    }

    await createAuditLog({
      req,
      action: "auth.password_reset_requested",
      entityType: "user",
      entityId: user.id,
      entityLabel: user.email,
      summary: `Password reset requested for ${user.email}`,
    })
  }

  res.json({
    message: "If an account with that email exists, we have sent password reset instructions.",
    previewResetUrl,
  })
})

export const resetPassword = asyncHandler(async (req, res) => {
  const token = String(req.body.token || "").trim()
  const password = String(req.body.password || "")

  if (!token || !password) {
    throw new ApiError(400, "Token and new password are required")
  }

  if (password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters long")
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
  const user = await User.findOne({
    resetPasswordTokenHash: tokenHash,
    resetPasswordExpiresAt: { $gt: new Date() },
  }).select("+resetPasswordTokenHash +resetPasswordExpiresAt")

  if (!user) {
    throw new ApiError(400, "This password reset link is invalid or has expired")
  }

  user.password = password
  user.resetPasswordTokenHash = null
  user.resetPasswordExpiresAt = null
  await user.save()

  queueNotification("password-changed-reset", () => sendPasswordChangedEmail({ user }))
  await createAuditLog({
    req,
    action: "auth.password_reset_completed",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
    summary: `Password reset completed for ${user.email}`,
  })

  res.json({
    message: "Password reset successfully",
    ...buildAuthResponse(user),
  })
})

export const changePassword = asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "")
  const newPassword = String(req.body.newPassword || "")

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Current password and new password are required")
  }

  if (newPassword.length < 8) {
    throw new ApiError(400, "New password must be at least 8 characters long")
  }

  const user = await User.findById(req.user.id).select("+password")
  if (!user) {
    throw new ApiError(404, "User not found")
  }

  const isPasswordValid = await user.comparePassword(currentPassword)
  if (!isPasswordValid) {
    throw new ApiError(401, "Current password is incorrect")
  }

  const isSamePassword = await user.comparePassword(newPassword)
  if (isSamePassword) {
    throw new ApiError(400, "New password must be different from the current password")
  }

  user.password = newPassword
  user.resetPasswordTokenHash = null
  user.resetPasswordExpiresAt = null
  await user.save()

  queueNotification("password-changed-profile", () => sendPasswordChangedEmail({ user }))
  await createAuditLog({
    req,
    action: "auth.password_changed",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
    summary: `Password changed for ${user.email}`,
  })

  res.json({
    message: "Password changed successfully",
    ...buildAuthResponse(user),
  })
})
