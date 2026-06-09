import assert from "node:assert/strict"
import test from "node:test"

process.env.CCAVENUE_MERCHANT_ID = "test-merchant"
process.env.CCAVENUE_ACCESS_CODE = "test-access-code"
process.env.CCAVENUE_WORKING_KEY = "unit-test-working-key"
process.env.CCAVENUE_MODE = "test"
process.env.BACKEND_PUBLIC_URL = "https://api.fastsewafilings.test"
process.env.FRONTEND_URL = "https://fastsewafilings.test"

const {
  buildCcavenueRequest,
  decryptCcavenuePayload,
  getCcavenuePaymentVerificationIssue,
  mapCcavenuePaymentState,
} = await import("../src/utils/ccavenue.js")
const { mapOrderToClient } = await import("../src/utils/orderHelpers.js")

test("buildCcavenueRequest uses the active payment attempt id as gateway order_id", () => {
  const attemptId = "ORD202600011779999999999"
  const request = buildCcavenueRequest({
    order: {
      id: "order_1001",
      orderNumber: "ORD-2026-0001",
      pricing: {
        totalAmount: 1180,
      },
      payment: {
        attemptId,
        currency: "INR",
      },
      serviceSnapshot: {
        name: "GST Registration",
      },
    },
    user: {
      id: "user_1001",
      name: "Chandravan",
      businessName: "Fastsewa Filings Pvt. Ltd.",
      address: "Patna",
      phone: "8275723755",
      email: "jhaji@fastsewa.com",
    },
  })

  const fields = Object.fromEntries(
    new URLSearchParams(decryptCcavenuePayload(request.fields.encRequest)).entries()
  )

  assert.equal(request.gateway, "ccavenue")
  assert.equal(request.method, "POST")
  assert.equal(request.actionUrl, "https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction")
  assert.equal(request.meta.merchantOrderId, attemptId)
  assert.equal(request.meta.attemptId, attemptId)
  assert.equal(fields.order_id, attemptId)
  assert.equal(fields.merchant_param1, "order_1001")
  assert.equal(fields.merchant_param5, attemptId)
  assert.equal(fields.redirect_url, "https://api.fastsewafilings.test/api/payments/ccavenue/callback")
  assert.equal(fields.cancel_url, "https://api.fastsewafilings.test/api/payments/ccavenue/callback")
})

test("mapCcavenuePaymentState keeps uncertain gateway responses under verification", () => {
  assert.deepEqual(mapCcavenuePaymentState("Success"), {
    paymentStatus: "paid",
    orderStatus: "processing",
    result: "success",
  })

  assert.deepEqual(mapCcavenuePaymentState("Failure"), {
    paymentStatus: "failed",
    orderStatus: "pending",
    result: "failed",
  })

  assert.deepEqual(mapCcavenuePaymentState("Awaited"), {
    paymentStatus: "verification_pending",
    orderStatus: "pending",
    result: "pending",
  })
})

test("mapOrderToClient surfaces expired initiated payments as verification_pending", () => {
  const expiredOrder = {
    id: "order_1001",
    orderNumber: "ORD-2026-0001",
    status: "pending",
    paymentStatus: "pending",
    pricing: {
      finalAmount: 1000,
    },
    payment: {
      attemptStatus: "initiated",
      attemptExpiresAt: new Date(Date.now() - 1000).toISOString(),
    },
    timeline: [],
    documents: [],
  }

  const activeOrder = {
    ...expiredOrder,
    payment: {
      attemptStatus: "initiated",
      attemptExpiresAt: new Date(Date.now() + 1000 * 60).toISOString(),
    },
  }

  assert.equal(mapOrderToClient(expiredOrder).paymentStatus, "verification_pending")
  assert.equal(mapOrderToClient(activeOrder).paymentStatus, "pending")
})

test("getCcavenuePaymentVerificationIssue accepts a matching success callback", () => {
  const issue = getCcavenuePaymentVerificationIssue({
    order: {
      orderNumber: "ORD-2026-0001",
      user: {
        id: "user_1001",
      },
      pricing: {
        totalAmount: 1180,
      },
      payment: {
        attemptId: "ORD202600011779999999999",
        merchantOrderId: "ORD202600011779999999999",
        currency: "INR",
      },
    },
    response: {
      order_id: "ORD202600011779999999999",
      amount: "1180.00",
      currency: "INR",
      merchant_param2: "user_1001",
      merchant_param5: "ORD202600011779999999999",
    },
  })

  assert.equal(issue, "")
})

test("getCcavenuePaymentVerificationIssue rejects mismatched payment details", () => {
  const order = {
    orderNumber: "ORD-2026-0001",
    user: {
      id: "user_1001",
    },
    pricing: {
      totalAmount: 1180,
    },
    payment: {
      attemptId: "ORD202600011779999999999",
      merchantOrderId: "ORD202600011779999999999",
      currency: "INR",
    },
  }

  assert.equal(
    getCcavenuePaymentVerificationIssue({
      order,
      response: {
        order_id: "WRONG-ORDER",
        amount: "1180.00",
        currency: "INR",
        merchant_param2: "user_1001",
        merchant_param5: "ORD202600011779999999999",
      },
    }),
    "CCAvenue gateway order id does not match this order."
  )

  assert.equal(
    getCcavenuePaymentVerificationIssue({
      order,
      response: {
        order_id: "ORD202600011779999999999",
        amount: "1000.00",
        currency: "INR",
        merchant_param2: "user_1001",
        merchant_param5: "ORD202600011779999999999",
      },
    }),
    "CCAvenue payment amount does not match the order total."
  )

  assert.equal(
    getCcavenuePaymentVerificationIssue({
      order,
      response: {
        order_id: "ORD202600011779999999999",
        amount: "1180.00",
        currency: "USD",
        merchant_param2: "user_1001",
        merchant_param5: "ORD202600011779999999999",
      },
    }),
    "CCAvenue payment currency does not match this order."
  )
})
