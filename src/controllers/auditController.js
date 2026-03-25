import { AuditLog } from "../models/AuditLog.js"
import { asyncHandler } from "../utils/asyncHandler.js"

function buildAuditQuery({ entityType = "All", search = "" }) {
  const query = {}

  if (entityType !== "All") {
    query.entityType = entityType
  }

  if (search) {
    query.$or = [
      { summary: { $regex: search, $options: "i" } },
      { action: { $regex: search, $options: "i" } },
      { entityLabel: { $regex: search, $options: "i" } },
      { "actorSnapshot.name": { $regex: search, $options: "i" } },
      { "actorSnapshot.email": { $regex: search, $options: "i" } },
    ]
  }

  return query
}

export const listAuditLogs = asyncHandler(async (req, res) => {
  const { limit = "60" } = req.query
  const parsedLimit = Math.min(Math.max(Number(limit) || 60, 1), 200)
  const query = buildAuditQuery(req.query)

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const [items, total, todayCount, entityCounts, recentActions] = await Promise.all([
    AuditLog.find(query).sort({ createdAt: -1 }).limit(parsedLimit),
    AuditLog.countDocuments(query),
    AuditLog.countDocuments({
      ...query,
      createdAt: { $gte: startOfDay },
    }),
    AuditLog.aggregate([
      { $match: query },
      { $group: { _id: "$entityType", count: { $sum: 1 } } },
    ]),
    AuditLog.aggregate([
      { $match: query },
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 8 },
    ]),
  ])

  res.json({
    items,
    summary: {
      total,
      today: todayCount,
      entityCounts,
      recentActions,
    },
  })
})
