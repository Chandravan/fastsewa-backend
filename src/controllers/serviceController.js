import { Service } from "../models/Service.js"
import { createAuditLog } from "../services/auditService.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { buildServiceLookupQuery } from "../utils/orderHelpers.js"

function buildServiceQuery({ category, search, popular, includeInactive = false }) {
  const query = includeInactive ? {} : { active: true }

  if (category && category !== "All") {
    query.category = category
  }

  if (popular === "true") {
    query.popular = true
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { category: { $regex: search, $options: "i" } },
    ]
  }

  return query
}

function normalizeDocuments(input) {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
}

function applyServicePayload(service, payload) {
  const allowedFields = [
    "code",
    "category",
    "name",
    "description",
    "basePrice",
    "discountPercent",
    "duration",
    "popular",
    "icon",
    "active",
  ]

  for (const field of allowedFields) {
    if (payload[field] !== undefined) {
      service[field] = payload[field]
    }
  }

  if (payload.documents !== undefined) {
    service.documents = normalizeDocuments(payload.documents)
  }
}

function buildMultiServiceLookupQuery(ids = []) {
  return ids.flatMap((identifier) => buildServiceLookupQuery(identifier))
}

async function findServiceOrThrow(identifier) {
  const service = await Service.findOne({
    $or: buildServiceLookupQuery(identifier),
  })

  if (!service) {
    throw new ApiError(404, "Service not found")
  }

  return service
}

function buildBulkServiceSummary(action, count) {
  const labels = {
    archive: "Archived",
    restore: "Restored",
    markPopular: "Marked popular",
    unmarkPopular: "Removed popular flag from",
  }

  return `${labels[action] || "Updated"} ${count} service${count === 1 ? "" : "s"}`
}

export const listServices = asyncHandler(async (req, res) => {
  const { category, search, popular } = req.query
  const query = buildServiceQuery({ category, search, popular })

  const [items, categories] = await Promise.all([
    Service.find(query).sort({ category: 1, name: 1 }),
    Service.distinct("category", { active: true }),
  ])

  res.json({
    items,
    categories: ["All", ...categories.sort()],
  })
})

export const getService = asyncHandler(async (req, res) => {
  const { serviceId } = req.params

  const service = await Service.findOne({
    $or: buildServiceLookupQuery(serviceId),
    active: true,
  })

  if (!service) {
    throw new ApiError(404, "Service not found")
  }

  res.json({ service })
})

export const listAdminServices = asyncHandler(async (req, res) => {
  const { category, search, popular, includeInactive = "true" } = req.query
  const query = buildServiceQuery({
    category,
    search,
    popular,
    includeInactive: includeInactive === "true",
  })

  const [items, categories] = await Promise.all([
    Service.find(query).sort({ active: -1, category: 1, name: 1 }),
    Service.distinct("category", {}),
  ])

  res.json({
    items,
    categories: categories.sort(),
  })
})

export const createService = asyncHandler(async (req, res) => {
  const { code, category, name, description, basePrice } = req.body

  if (!code || !category || !name || !description || basePrice === undefined) {
    throw new ApiError(400, "Code, category, name, description, and basePrice are required")
  }

  const existingService = await Service.findOne({
    $or: [{ code }, { name }],
  })

  if (existingService) {
    throw new ApiError(409, "A service with this code or name already exists")
  }

  const service = new Service()
  applyServicePayload(service, {
    ...req.body,
    code: String(code).trim(),
    category: String(category).trim(),
    name: String(name).trim(),
    description: String(description).trim(),
    basePrice: Number(basePrice),
    discountPercent: Number(req.body.discountPercent || 0),
  })

  await service.save()
  await createAuditLog({
    req,
    action: "service.create",
    entityType: "service",
    entityId: service.id,
    entityLabel: service.name,
    summary: `Created service ${service.name}`,
    metadata: {
      code: service.code,
      category: service.category,
      active: service.active,
    },
  })

  res.status(201).json({
    message: "Service created successfully",
    service,
  })
})

export const updateService = asyncHandler(async (req, res) => {
  const service = await findServiceOrThrow(req.params.serviceId)

  if (req.body.code && req.body.code !== service.code) {
    const existingByCode = await Service.findOne({ code: req.body.code })
    if (existingByCode && existingByCode.id !== service.id) {
      throw new ApiError(409, "A service with this code already exists")
    }
  }

  applyServicePayload(service, {
    ...req.body,
    basePrice: req.body.basePrice !== undefined ? Number(req.body.basePrice) : undefined,
    discountPercent: req.body.discountPercent !== undefined ? Number(req.body.discountPercent) : undefined,
  })

  await service.save()
  await createAuditLog({
    req,
    action: "service.update",
    entityType: "service",
    entityId: service.id,
    entityLabel: service.name,
    summary: `Updated service ${service.name}`,
    metadata: {
      code: service.code,
      active: service.active,
      popular: service.popular,
    },
  })

  res.json({
    message: "Service updated successfully",
    service,
  })
})

export const archiveService = asyncHandler(async (req, res) => {
  const service = await findServiceOrThrow(req.params.serviceId)

  service.active = false
  await service.save()
  await createAuditLog({
    req,
    action: "service.archive",
    entityType: "service",
    entityId: service.id,
    entityLabel: service.name,
    summary: `Archived service ${service.name}`,
  })

  res.json({
    message: "Service archived successfully",
    service,
  })
})

export const restoreService = asyncHandler(async (req, res) => {
  const service = await findServiceOrThrow(req.params.serviceId)

  service.active = true
  await service.save()
  await createAuditLog({
    req,
    action: "service.restore",
    entityType: "service",
    entityId: service.id,
    entityLabel: service.name,
    summary: `Restored service ${service.name}`,
  })

  res.json({
    message: "Service restored successfully",
    service,
  })
})

export const bulkServiceAction = asyncHandler(async (req, res) => {
  const { ids = [], action } = req.body

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "Select at least one service")
  }

  const services = await Service.find({
    $or: buildMultiServiceLookupQuery(ids),
  })

  if (services.length === 0) {
    throw new ApiError(404, "No matching services found for the bulk action")
  }

  for (const service of services) {
    if (action === "archive") {
      service.active = false
    } else if (action === "restore") {
      service.active = true
    } else if (action === "markPopular") {
      service.popular = true
    } else if (action === "unmarkPopular") {
      service.popular = false
    } else {
      throw new ApiError(400, "Unsupported bulk service action")
    }
  }

  await Promise.all(services.map((service) => service.save()))
  await createAuditLog({
    req,
    action: `service.bulk.${action}`,
    entityType: "service",
    summary: buildBulkServiceSummary(action, services.length),
    metadata: {
      ids: services.map((service) => service.id),
      names: services.map((service) => service.name),
      count: services.length,
    },
  })

  res.json({
    message: buildBulkServiceSummary(action, services.length),
    items: services,
    count: services.length,
  })
})
