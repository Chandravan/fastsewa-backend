export const ADMIN_PERMISSION_GROUPS = [
  {
    id: "dashboard",
    label: "Control Tower",
    permissions: [
      {
        key: "dashboard.view",
        label: "View dashboard",
        description: "See the admin overview, queue health, and platform stats.",
      },
    ],
  },
  {
    id: "orders",
    label: "Order Operations",
    permissions: [
      {
        key: "orders.view",
        label: "View orders",
        description: "Open the order desk and inspect client orders.",
      },
      {
        key: "orders.manage",
        label: "Manage orders",
        description: "Update status, payment state, assignment, and notes.",
      },
      {
        key: "orders.bulk",
        label: "Bulk order actions",
        description: "Apply status or assignment updates to multiple orders at once.",
      },
    ],
  },
  {
    id: "services",
    label: "Catalog Management",
    permissions: [
      {
        key: "services.view",
        label: "View services",
        description: "Open the service studio and inspect the catalog.",
      },
      {
        key: "services.manage",
        label: "Manage services",
        description: "Create and edit services.",
      },
      {
        key: "services.archive",
        label: "Archive services",
        description: "Archive services from the public catalog.",
      },
      {
        key: "services.restore",
        label: "Restore services",
        description: "Restore archived services back to the public catalog.",
      },
      {
        key: "services.bulk",
        label: "Bulk service actions",
        description: "Archive, restore, or flag many services together.",
      },
    ],
  },
  {
    id: "users",
    label: "People Operations",
    permissions: [
      {
        key: "users.view",
        label: "View users",
        description: "Open the user desk and inspect account activity.",
      },
      {
        key: "users.manage",
        label: "Manage users",
        description: "Create accounts and update user profile data or roles.",
      },
      {
        key: "users.disable",
        label: "Disable users",
        description: "Disable or re-enable access for accounts.",
      },
      {
        key: "users.delete",
        label: "Delete users",
        description: "Permanently delete eligible accounts.",
      },
      {
        key: "users.bulk",
        label: "Bulk user actions",
        description: "Apply enable, disable, or role actions to multiple users.",
      },
    ],
  },
  {
    id: "audit",
    label: "Audit & Trace",
    permissions: [
      {
        key: "audit.view",
        label: "View audit log",
        description: "Inspect admin actions and operational history.",
      },
    ],
  },
]

export const ADMIN_PERMISSION_KEYS = ADMIN_PERMISSION_GROUPS.flatMap((group) => (
  group.permissions.map((permission) => permission.key)
))

export const ADMIN_PERMISSION_TEMPLATES = [
  {
    key: "super_admin",
    label: "Super Admin",
    description: "Full access to every admin capability.",
    permissions: ["*"],
  },
  {
    key: "operations_manager",
    label: "Operations Manager",
    description: "Owns order movement, queue health, and audit visibility.",
    permissions: [
      "dashboard.view",
      "orders.view",
      "orders.manage",
      "orders.bulk",
      "audit.view",
    ],
  },
  {
    key: "catalog_manager",
    label: "Catalog Manager",
    description: "Owns service launch, edits, and catalog lifecycle changes.",
    permissions: [
      "dashboard.view",
      "services.view",
      "services.manage",
      "services.archive",
      "services.restore",
      "services.bulk",
      "audit.view",
    ],
  },
  {
    key: "support_manager",
    label: "Support Manager",
    description: "Handles client accounts, order follow-ups, and audit visibility.",
    permissions: [
      "dashboard.view",
      "orders.view",
      "orders.manage",
      "users.view",
      "users.manage",
      "users.disable",
      "audit.view",
    ],
  },
]

export function getPermissionTemplate(templateKey) {
  return ADMIN_PERMISSION_TEMPLATES.find((template) => template.key === templateKey) || null
}

export function getDefaultPermissionsForRole(role) {
  return role === "admin" ? ["*"] : []
}

export function normalizeAdminPermissions(input, role, options = {}) {
  const { fallbackToFull = false } = options

  if (role !== "admin") {
    return []
  }

  const values = Array.isArray(input)
    ? input
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : []

  const uniqueValues = Array.from(new Set(values))
  if (uniqueValues.includes("*")) {
    return ["*"]
  }

  const validValues = uniqueValues.filter((value) => ADMIN_PERMISSION_KEYS.includes(value))
  if (validValues.length > 0) {
    return validValues
  }

  return fallbackToFull ? ["*"] : []
}

export function userHasPermission(user, permission) {
  if (!user || user.role !== "admin") {
    return false
  }

  const permissions = normalizeAdminPermissions(user.permissions, user.role, { fallbackToFull: true })
  return permissions.includes("*") || permissions.includes(permission)
}

export function userHasAnyPermission(user, permissions) {
  return Array.isArray(permissions) && permissions.some((permission) => userHasPermission(user, permission))
}
