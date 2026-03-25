import { AuditLog } from "../models/AuditLog.js"

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata ?? null
  }

  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, value === null ? null : value])

  return entries.length > 0 ? Object.fromEntries(entries) : null
}

function getIpAddress(req) {
  const forwarded = req.headers["x-forwarded-for"]
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim()
  }

  return req.ip || req.socket?.remoteAddress || ""
}

export async function createAuditLog({ req, action, entityType = "system", entityId = "", entityLabel = "", summary, metadata = null }) {
  if (!req?.user || !action || !summary) {
    return null
  }

  return AuditLog.create({
    actor: req.user._id,
    actorSnapshot: {
      name: req.user.name || "",
      email: req.user.email || "",
      role: req.user.role || "",
    },
    action,
    entityType,
    entityId: entityId ? String(entityId) : "",
    entityLabel: entityLabel ? String(entityLabel) : "",
    summary,
    metadata: sanitizeMetadata(metadata),
    ipAddress: getIpAddress(req),
    userAgent: req.headers["user-agent"] || "",
  })
}
