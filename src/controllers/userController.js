import {
  getPermissionTemplate,
  normalizeAdminPermissions,
} from "../constants/adminPermissions.js"
import { Order } from "../models/Order.js"
import { User } from "../models/User.js"
import { createAuditLog } from "../services/auditService.js"
import { queueNotification, sendWelcomeEmail } from "../services/notificationService.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const PROFILE_FIELDS = ["name", "phone", "businessName", "pan", "gstin", "address"]

function buildUserQuery({ role = "All", status = "All", search = "" }) {
  const query = {}

  if (role !== "All") {
    query.role = role
  }

  if (status === "active") {
    query.active = { $ne: false }
  }

  if (status === "disabled") {
    query.active = false
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { businessName: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ]
  }

  return query
}

function buildStatsByUser(orderStats) {
  return new Map(orderStats.map((entry) => [entry._id.toString(), entry]))
}

function decorateUsersWithStats(users, statsByUserId) {
  return users.map((user) => {
    const stats = statsByUserId.get(user.id)

    return {
      ...user.toJSON(),
      stats: {
        orderCount: stats?.orderCount || 0,
        totalBilled: stats?.totalBilled || 0,
        lastOrderAt: stats?.lastOrderAt || null,
      },
    }
  })
}

function resolvePermissionsFromPayload(payload, currentUser = null) {
  const nextRole = payload.role !== undefined ? payload.role : currentUser?.role || "client"
  const templatePermissions = payload.permissionTemplate
    ? getPermissionTemplate(payload.permissionTemplate)?.permissions
    : null
  const rawPermissions = templatePermissions || payload.permissions

  if (rawPermissions !== undefined) {
    return normalizeAdminPermissions(rawPermissions, nextRole, {
      fallbackToFull: nextRole === "admin",
    })
  }

  return normalizeAdminPermissions(currentUser?.permissions, nextRole, {
    fallbackToFull: nextRole === "admin",
  })
}

async function ensureAdminAccessIsProtected({ targetUser, actingUser, nextRole = targetUser.role, nextActive = targetUser.active !== false }) {
  const targetId = targetUser.id
  const actingUserId = actingUser.id
  const removesAdminAccess = targetUser.role === "admin" && (nextRole !== "admin" || nextActive === false)

  if (targetId === actingUserId && removesAdminAccess) {
    throw new ApiError(400, "You cannot remove your own admin access")
  }

  if (!removesAdminAccess) {
    return
  }

  const otherActiveAdmins = await User.countDocuments({
    _id: { $ne: targetUser._id },
    role: "admin",
    active: { $ne: false },
  })

  if (otherActiveAdmins === 0) {
    throw new ApiError(400, "At least one active admin account must remain on the platform")
  }
}

async function findUserOrThrow(userId) {
  const user = await User.findById(userId)
  if (!user) {
    throw new ApiError(404, "User not found")
  }
  return user
}

export const getProfile = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toJSON() })
})

export const updateProfile = asyncHandler(async (req, res) => {
  for (const field of PROFILE_FIELDS) {
    if (req.body[field] !== undefined) {
      req.user[field] = req.body[field]
    }
  }

  await req.user.save()

  res.json({
    message: "Profile updated successfully",
    user: req.user.toJSON(),
  })
})

export const listUsersAdmin = asyncHandler(async (req, res) => {
  const query = buildUserQuery(req.query)

  const [users, orderStats] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }),
    Order.aggregate([
      {
        $group: {
          _id: "$user",
          orderCount: { $sum: 1 },
          totalBilled: { $sum: "$pricing.totalAmount" },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
    ]),
  ])

  res.json({
    items: decorateUsersWithStats(users, buildStatsByUser(orderStats)),
  })
})

export const createUserAdmin = asyncHandler(async (req, res) => {
  const { name, email, password, role = "client" } = req.body

  if (!name || !email || !password) {
    throw new ApiError(400, "Name, email, and password are required")
  }

  if (password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters long")
  }

  const normalizedEmail = String(email).toLowerCase().trim()
  const existingUser = await User.findOne({ email: normalizedEmail })
  if (existingUser) {
    throw new ApiError(409, "A user with this email already exists")
  }

  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    role,
    permissions: resolvePermissionsFromPayload(req.body),
    active: req.body.active !== false,
    phone: req.body.phone || "",
    businessName: req.body.businessName || "",
    pan: req.body.pan || "",
    gstin: req.body.gstin || "",
    address: req.body.address || "",
  })

  queueNotification("welcome-email-admin-created-user", () => sendWelcomeEmail({ user }))
  await createAuditLog({
    req,
    action: "user.create",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
    summary: `Created ${user.role} account for ${user.email}`,
    metadata: {
      role: user.role,
      active: user.active,
      permissions: user.permissions,
    },
  })

  res.status(201).json({
    message: "User created successfully",
    user: user.toJSON(),
  })
})

export const updateUserAdmin = asyncHandler(async (req, res) => {
  const user = await findUserOrThrow(req.params.userId)
  const nextRole = req.body.role !== undefined ? req.body.role : user.role

  await ensureAdminAccessIsProtected({
    targetUser: user,
    actingUser: req.user,
    nextRole,
    nextActive: user.active !== false,
  })

  if (req.body.email) {
    const nextEmail = String(req.body.email).toLowerCase().trim()
    if (nextEmail !== user.email) {
      const existingUser = await User.findOne({ email: nextEmail })
      if (existingUser && existingUser.id !== user.id) {
        throw new ApiError(409, "A user with this email already exists")
      }
    }
  }

  const allowedFields = ["name", "email", "phone", "businessName", "pan", "gstin", "address", "role"]
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      user[field] = field === "email"
        ? String(req.body[field]).toLowerCase().trim()
        : req.body[field]
    }
  }

  if (req.body.permissions !== undefined || req.body.permissionTemplate !== undefined || req.body.role !== undefined) {
    user.permissions = resolvePermissionsFromPayload(req.body, user)
  }

  await user.save()
  await createAuditLog({
    req,
    action: "user.update",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
    summary: `Updated account ${user.email}`,
    metadata: {
      role: user.role,
      active: user.active,
      permissions: user.permissions,
    },
  })

  res.json({
    message: "User updated successfully",
    user: user.toJSON(),
  })
})

export const setUserStatusAdmin = asyncHandler(async (req, res) => {
  const user = await findUserOrThrow(req.params.userId)
  const nextActive = req.body.active !== false

  await ensureAdminAccessIsProtected({
    targetUser: user,
    actingUser: req.user,
    nextRole: user.role,
    nextActive,
  })

  user.active = nextActive
  user.disabledReason = nextActive ? "" : String(req.body.disabledReason || "").trim()
  if (!nextActive && !user.disabledReason) {
    user.disabledReason = "Disabled by admin"
  }

  await user.save()
  await createAuditLog({
    req,
    action: nextActive ? "user.enable" : "user.disable",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
    summary: `${nextActive ? "Enabled" : "Disabled"} account ${user.email}`,
    metadata: {
      active: user.active,
      disabledReason: user.disabledReason || null,
    },
  })

  res.json({
    message: nextActive ? "User enabled successfully" : "User disabled successfully",
    user: user.toJSON(),
  })
})

export const deleteUserAdmin = asyncHandler(async (req, res) => {
  const user = await findUserOrThrow(req.params.userId)
  await ensureAdminAccessIsProtected({
    targetUser: user,
    actingUser: req.user,
    nextRole: "client",
    nextActive: false,
  })

  const orderCount = await Order.countDocuments({ user: user._id })
  if (orderCount > 0) {
    throw new ApiError(409, "Only users without orders can be permanently deleted")
  }

  const userSnapshot = user.toJSON()
  await user.deleteOne()
  await createAuditLog({
    req,
    action: "user.delete",
    entityType: "user",
    entityId: userSnapshot.id,
    entityLabel: userSnapshot.email,
    summary: `Deleted account ${userSnapshot.email}`,
  })

  res.json({
    message: "User deleted successfully",
    deletedUserId: userSnapshot.id,
  })
})

export const bulkUserActionAdmin = asyncHandler(async (req, res) => {
  const { ids = [], action } = req.body

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "Select at least one user")
  }

  const users = await User.find({ _id: { $in: ids } })
  if (users.length === 0) {
    throw new ApiError(404, "No matching users found for the bulk action")
  }

  const updatedUsers = []
  const deletedUserIds = []
  const skipped = []

  for (const user of users) {
    if (action === "enable" || action === "disable") {
      const nextActive = action === "enable"
      try {
        await ensureAdminAccessIsProtected({
          targetUser: user,
          actingUser: req.user,
          nextRole: user.role,
          nextActive,
        })
      } catch (error) {
        skipped.push({ id: user.id, email: user.email, reason: error.message })
        continue
      }

      user.active = nextActive
      user.disabledReason = nextActive ? "" : String(req.body.disabledReason || "").trim() || "Disabled by admin"
      await user.save()
      updatedUsers.push(user.toJSON())
      continue
    }

    if (action === "promoteToAdmin" || action === "convertToClient") {
      const nextRole = action === "promoteToAdmin" ? "admin" : "client"
      try {
        await ensureAdminAccessIsProtected({
          targetUser: user,
          actingUser: req.user,
          nextRole,
          nextActive: user.active !== false,
        })
      } catch (error) {
        skipped.push({ id: user.id, email: user.email, reason: error.message })
        continue
      }

      user.role = nextRole
      user.permissions = normalizeAdminPermissions(
        action === "promoteToAdmin"
          ? (getPermissionTemplate(req.body.permissionTemplate)?.permissions || ["*"])
          : [],
        nextRole,
        { fallbackToFull: nextRole === "admin" }
      )
      await user.save()
      updatedUsers.push(user.toJSON())
      continue
    }

    if (action === "delete") {
      try {
        await ensureAdminAccessIsProtected({
          targetUser: user,
          actingUser: req.user,
          nextRole: "client",
          nextActive: false,
        })
      } catch (error) {
        skipped.push({ id: user.id, email: user.email, reason: error.message })
        continue
      }

      const orderCount = await Order.countDocuments({ user: user._id })
      if (orderCount > 0) {
        skipped.push({ id: user.id, email: user.email, reason: "User has orders and cannot be deleted" })
        continue
      }

      deletedUserIds.push(user.id)
      await user.deleteOne()
      continue
    }

    throw new ApiError(400, "Unsupported bulk user action")
  }

  const affectedCount = updatedUsers.length + deletedUserIds.length
  await createAuditLog({
    req,
    action: `user.bulk.${action}`,
    entityType: "user",
    summary: `Applied bulk user action ${action} to ${affectedCount} account${affectedCount === 1 ? "" : "s"}`,
    metadata: {
      updatedUserIds: updatedUsers.map((user) => user.id),
      deletedUserIds,
      skipped,
      count: affectedCount,
    },
  })

  res.json({
    message: `Bulk user action ${action} completed`,
    items: updatedUsers,
    deletedUserIds,
    skipped,
    count: affectedCount,
  })
})
