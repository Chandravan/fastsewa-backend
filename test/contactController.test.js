import assert from "node:assert/strict"
import test from "node:test"
import { ApiError } from "../src/utils/ApiError.js"
import { buildContactController } from "../src/controllers/contactController.js"

function executeHandler(handler, req = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const response = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        this.body = payload
        if (!settled) {
          settled = true
          resolve(this)
        }
        return this
      },
    }

    const next = (error) => {
      if (settled) return
      settled = true
      if (error) {
        reject(error)
        return
      }
      resolve(response)
    }

    try {
      handler(req, response, next)
    } catch (error) {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
  })
}

function createControllerMocks(overrides = {}) {
  const mock = {
    createCalls: [],
    findByIdCalls: [],
    findCalls: [],
    countCalls: [],
    queuedLabels: [],
    notificationCreateCalls: [],
    notificationUpdateCalls: [],
    auditCalls: [],
    inquiryRecord: null,
  }

  const ContactInquiryModel = {
    async create(payload) {
      mock.createCalls.push(payload)
      const record = {
        id: "inq_1001",
        createdAt: "2026-03-30T10:00:00.000Z",
        ...payload,
      }
      mock.inquiryRecord = record
      return record
    },
    find(query) {
      mock.findCalls.push(query)
      return {
        sort(sortQuery) {
          mock.sortQuery = sortQuery
          return {
            limit(limit) {
              mock.limit = limit
              return Promise.resolve([
                {
                  toJSON() {
                    return {
                      id: "inq_2001",
                      name: "Aman",
                      email: "aman@example.com",
                      message: "Need GST filing support urgently",
                      status: "new",
                      adminNotes: "",
                      source: "website",
                      createdAt: "2026-03-30T11:00:00.000Z",
                      updatedAt: "2026-03-30T11:00:00.000Z",
                    }
                  },
                },
              ])
            },
          }
        },
      }
    },
    async countDocuments(query = {}) {
      mock.countCalls.push(query)
      if (!query || Object.keys(query).length === 0) return 12
      if (query.status === "new") return 5
      if (query.status === "in_progress") return 4
      if (query.status === "closed") return 3
      return 0
    },
    async findById(id) {
      mock.findByIdCalls.push(id)
      const item = {
        id,
        email: "client@example.com",
        name: "Rakesh",
        status: "new",
        adminNotes: "Initial note",
        updatedAt: "2026-03-30T12:00:00.000Z",
        async save() {
          mock.saved = true
        },
        toJSON() {
          return {
            id: this.id,
            name: this.name,
            email: this.email,
            message: "Please help with return filing",
            source: "website",
            status: this.status,
            adminNotes: this.adminNotes,
            createdAt: "2026-03-30T09:00:00.000Z",
            updatedAt: this.updatedAt,
          }
        },
      }
      mock.inquiryRecord = item
      return item
    },
  }

  const queueNotificationFn = (label, task) => {
    mock.queuedLabels.push(label)
    return Promise.resolve().then(task)
  }

  const sendContactInquiryNotificationsFn = async ({ inquiry }) => {
    mock.notificationCreateCalls.push(inquiry)
    return { delivered: true }
  }

  const sendContactInquiryUpdatedEmailFn = async (payload) => {
    mock.notificationUpdateCalls.push(payload)
    return { delivered: true }
  }

  const createAuditLogFn = async (payload) => {
    mock.auditCalls.push(payload)
    return { id: "audit_001" }
  }

  const controller = buildContactController({
    ContactInquiryModel,
    queueNotificationFn,
    sendContactInquiryNotificationsFn,
    sendContactInquiryUpdatedEmailFn,
    createAuditLogFn,
    ...overrides,
  })

  return { controller, mock }
}

test("submitContactInquiry stores inquiry and queues notification", async () => {
  const { controller, mock } = createControllerMocks()

  const res = await executeHandler(controller.submitContactInquiry, {
    body: {
      name: "  Raj Kumar  ",
      email: "  RAJ@EXAMPLE.COM ",
      message: "  I need help with GST registration and filing support.  ",
    },
    headers: {
      "user-agent": "unit-test-agent",
      "x-forwarded-for": "203.0.113.10",
    },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  })

  assert.equal(res.statusCode, 201)
  assert.equal(res.body.message, "Message sent successfully. Our team will contact you shortly.")
  assert.equal(res.body.inquiryId, "inq_1001")
  assert.equal(mock.createCalls.length, 1)
  assert.equal(mock.createCalls[0].name, "Raj Kumar")
  assert.equal(mock.createCalls[0].email, "raj@example.com")
  assert.equal(mock.createCalls[0].source, "website")
  assert.equal(mock.queuedLabels[0], "contact-inquiry-email")
  assert.equal(mock.notificationCreateCalls.length, 1)
})

test("submitContactInquiry rejects invalid email", async () => {
  const { controller } = createControllerMocks()

  await assert.rejects(
    executeHandler(controller.submitContactInquiry, {
      body: {
        name: "Raj",
        email: "invalid-email",
        message: "I need help with tax filing support.",
      },
      headers: {},
    }),
    (error) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.statusCode, 400)
      assert.equal(error.message, "Please enter a valid email address")
      return true
    }
  )
})

test("listContactInquiriesAdmin returns filtered items with stats", async () => {
  const { controller, mock } = createControllerMocks()

  const res = await executeHandler(controller.listContactInquiriesAdmin, {
    query: {
      status: "in_progress",
      search: "gst",
      limit: "50",
    },
  })

  assert.equal(res.statusCode, 200)
  assert.equal(Array.isArray(res.body.items), true)
  assert.equal(res.body.items.length, 1)
  assert.equal(res.body.stats.total, 12)
  assert.equal(res.body.stats.new, 5)
  assert.equal(res.body.stats.inProgress, 4)
  assert.equal(res.body.stats.closed, 3)
  assert.equal(mock.findCalls.length, 1)
  assert.equal(mock.findCalls[0].status, "in_progress")
  assert.equal(Array.isArray(mock.findCalls[0].$or), true)
  assert.equal(mock.limit, 50)
})

test("updateContactInquiryAdmin saves status/notes and queues update notification", async () => {
  const { controller, mock } = createControllerMocks()

  const res = await executeHandler(controller.updateContactInquiryAdmin, {
    params: {
      inquiryId: "69c953096752a065a9c7006b",
    },
    body: {
      status: "in_progress",
      adminNotes: "We called you and requested GST documents.",
    },
    user: {
      _id: "admin_user_1",
      name: "Admin",
      email: "admin@fastsewa.in",
      role: "admin",
    },
    headers: {
      "user-agent": "unit-test-agent",
    },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.message, "Inquiry updated successfully")
  assert.equal(mock.saved, true)
  assert.equal(mock.inquiryRecord.status, "in_progress")
  assert.equal(mock.inquiryRecord.adminNotes, "We called you and requested GST documents.")
  assert.equal(mock.queuedLabels.includes("contact-inquiry-updated-email"), true)
  assert.equal(mock.notificationUpdateCalls.length, 1)
  assert.equal(mock.notificationUpdateCalls[0].previousState.status, "new")
  assert.equal(mock.notificationUpdateCalls[0].previousState.adminNotes, "Initial note")
  assert.equal(mock.auditCalls.length, 1)
  assert.equal(mock.auditCalls[0].entityType, "contact_inquiry")
})
