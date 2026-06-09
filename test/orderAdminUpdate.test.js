import assert from "node:assert/strict"
import test from "node:test"

import { applyAdminOrderUpdate } from "../src/controllers/orderController.js"
import { ApiError } from "../src/utils/ApiError.js"

const actor = {
  _id: "admin_1001",
  name: "Admin User",
  email: "admin@fastsewa.com",
  role: "admin",
}

function createOrder(overrides = {}) {
  return {
    status: "pending",
    paymentStatus: "verification_pending",
    assignedTo: null,
    notes: "",
    payment: {
      gateway: "ccavenue",
      attemptStatus: "verification_pending",
      trackingId: "",
      bankRefNo: "",
      auditTrail: [],
    },
    timeline: [
      { status: "Order placed", date: new Date(), done: true },
      { status: "Payment received", date: null, done: false },
      { status: "Processing started", date: null, done: false },
      { status: "Completed", date: null, done: false },
    ],
    ...overrides,
  }
}

test("applyAdminOrderUpdate requires a verification note when payment status changes", () => {
  const order = createOrder()

  assert.throws(
    () => applyAdminOrderUpdate(order, { paymentStatus: "paid" }, actor),
    (error) => error instanceof ApiError && error.statusCode === 400
  )
})

test("applyAdminOrderUpdate stores manual payment audit details", () => {
  const order = createOrder()

  const result = applyAdminOrderUpdate(order, {
    paymentStatus: "paid",
    paymentVerificationSource: "CCAvenue dashboard",
    paymentVerificationNote: "Verified in CCAvenue dashboard. Amount and INR matched.",
    paymentTrackingId: "trk_1001",
    paymentBankRefNo: "bank_1001",
  }, actor)

  assert.equal(order.paymentStatus, "paid")
  assert.equal(order.status, "processing")
  assert.equal(order.assignedTo, "FastSewa CA Team")
  assert.equal(order.payment.attemptStatus, "success")
  assert.equal(order.payment.trackingId, "trk_1001")
  assert.equal(order.payment.bankRefNo, "bank_1001")
  assert.equal(order.payment.auditTrail.length, 1)
  assert.equal(order.payment.auditTrail[0].fromStatus, "verification_pending")
  assert.equal(order.payment.auditTrail[0].toStatus, "paid")
  assert.equal(order.payment.auditTrail[0].source, "CCAvenue dashboard")
  assert.equal(order.payment.auditTrail[0].changedBySnapshot.email, "admin@fastsewa.com")
  assert.equal(result.paymentJustCompleted, true)
  assert.equal(result.paymentAuditEntry.note, "Verified in CCAvenue dashboard. Amount and INR matched.")
  assert.equal(order.timeline.find((step) => step.status === "Payment received").done, true)
})
