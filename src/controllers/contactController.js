import { ContactInquiry } from "../models/ContactInquiry.js"
import { createAuditLog } from "../services/auditService.js"
import {
  queueNotification,
  sendContactInquiryNotifications,
  sendContactInquiryUpdatedEmail,
} from "../services/notificationService.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INQUIRY_STATUSES = ["new", "in_progress", "closed"]

function mapInquiry(inquiry) {
  const item = inquiry?.toJSON ? inquiry.toJSON() : inquiry
  return {
    id: item.id || item._id?.toString?.() || "",
    name: item.name || "",
    email: item.email || "",
    message: item.message || "",
    source: item.source || "website",
    status: item.status || "new",
    adminNotes: item.adminNotes || "",
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  }
}

function getIpAddress(req) {
  const forwarded = req.headers["x-forwarded-for"]
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim()
  }

  return req.ip || req.socket?.remoteAddress || ""
}

function getDefaultDependencies() {
  return {
    ContactInquiryModel: ContactInquiry,
    createAuditLogFn: createAuditLog,
    queueNotificationFn: queueNotification,
    sendContactInquiryNotificationsFn: sendContactInquiryNotifications,
    sendContactInquiryUpdatedEmailFn: sendContactInquiryUpdatedEmail,
  }
}

export function buildContactController(dependencies = {}) {
  const {
    ContactInquiryModel,
    createAuditLogFn,
    queueNotificationFn,
    sendContactInquiryNotificationsFn,
    sendContactInquiryUpdatedEmailFn,
  } = {
    ...getDefaultDependencies(),
    ...dependencies,
  }

  const submitContactInquiry = asyncHandler(async (req, res) => {
    const name = String(req.body.name || "").trim()
    const email = String(req.body.email || "").trim().toLowerCase()
    const message = String(req.body.message || "").trim()

    if (!name || !email || !message) {
      throw new ApiError(400, "Name, email, and message are required")
    }

    if (name.length < 2) {
      throw new ApiError(400, "Name must be at least 2 characters long")
    }

    if (!EMAIL_REGEX.test(email)) {
      throw new ApiError(400, "Please enter a valid email address")
    }

    if (message.length < 10) {
      throw new ApiError(400, "Message must be at least 10 characters long")
    }

    const inquiry = await ContactInquiryModel.create({
      name,
      email,
      message,
      source: "website",
      ipAddress: getIpAddress(req),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 400),
    })

    queueNotificationFn("contact-inquiry-email", () => sendContactInquiryNotificationsFn({ inquiry }))

    res.status(201).json({
      message: "Message sent successfully. Our team will contact you shortly.",
      inquiryId: inquiry.id,
    })
  })

  const listContactInquiriesAdmin = asyncHandler(async (req, res) => {
    const status = String(req.query.status || "").trim()
    const search = String(req.query.search || "").trim()
    const parsedLimit = Number(req.query.limit)
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 200
    const query = {}

    if (INQUIRY_STATUSES.includes(status)) {
      query.status = status
    }

    if (search) {
      const pattern = { $regex: search, $options: "i" }
      query.$or = [
        { name: pattern },
        { email: pattern },
        { message: pattern },
        { adminNotes: pattern },
      ]
    }

    const [items, total, newCount, inProgressCount, closedCount] = await Promise.all([
      ContactInquiryModel.find(query).sort({ createdAt: -1 }).limit(limit),
      ContactInquiryModel.countDocuments({}),
      ContactInquiryModel.countDocuments({ status: "new" }),
      ContactInquiryModel.countDocuments({ status: "in_progress" }),
      ContactInquiryModel.countDocuments({ status: "closed" }),
    ])

    res.json({
      items: items.map(mapInquiry),
      stats: {
        total,
        new: newCount,
        inProgress: inProgressCount,
        closed: closedCount,
      },
    })
  })

  const updateContactInquiryAdmin = asyncHandler(async (req, res) => {
    const inquiry = await ContactInquiryModel.findById(req.params.inquiryId)
    if (!inquiry) {
      throw new ApiError(404, "Contact inquiry not found")
    }
    const previousState = {
      status: inquiry.status,
      adminNotes: inquiry.adminNotes || "",
    }

    const nextStatus = req.body.status !== undefined ? String(req.body.status || "").trim() : undefined
    const nextAdminNotes = req.body.adminNotes !== undefined ? String(req.body.adminNotes || "").trim() : undefined

    if (nextStatus === undefined && nextAdminNotes === undefined) {
      throw new ApiError(400, "Provide at least one field to update")
    }

    if (nextStatus !== undefined) {
      if (!INQUIRY_STATUSES.includes(nextStatus)) {
        throw new ApiError(400, "Invalid inquiry status")
      }
      inquiry.status = nextStatus
    }

    if (nextAdminNotes !== undefined) {
      inquiry.adminNotes = nextAdminNotes
    }

    await inquiry.save()
    queueNotificationFn("contact-inquiry-updated-email", () => sendContactInquiryUpdatedEmailFn({
      inquiry,
      previousState,
    }))

    await createAuditLogFn({
      req,
      action: "contact_inquiry.update",
      entityType: "contact_inquiry",
      entityId: inquiry.id,
      entityLabel: inquiry.email,
      summary: `Updated contact inquiry ${inquiry.id}`,
      metadata: {
        status: inquiry.status,
        hasNotes: Boolean(inquiry.adminNotes),
      },
    })

    res.json({
      message: "Inquiry updated successfully",
      inquiry: mapInquiry(inquiry),
    })
  })

  return {
    submitContactInquiry,
    listContactInquiriesAdmin,
    updateContactInquiryAdmin,
  }
}

const contactController = buildContactController()

export const submitContactInquiry = contactController.submitContactInquiry
export const listContactInquiriesAdmin = contactController.listContactInquiriesAdmin
export const updateContactInquiryAdmin = contactController.updateContactInquiryAdmin
