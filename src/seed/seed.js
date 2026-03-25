import { connectDB } from "../config/db.js"
import { env } from "../config/env.js"
import { AuditLog } from "../models/AuditLog.js"
import { Order } from "../models/Order.js"
import { Service } from "../models/Service.js"
import { User } from "../models/User.js"
import { buildPricing, createInitialTimeline } from "../utils/orderHelpers.js"
import { serviceCatalog } from "./serviceCatalog.js"

async function seed() {
  await connectDB()

  await Promise.all([
    Service.deleteMany({}),
    Order.deleteMany({}),
    AuditLog.deleteMany({}),
  ])

  await Service.insertMany(serviceCatalog)

  await User.deleteMany({ email: { $in: ["admin@fastsewa.in", "demo@fastsewa.in"] } })

  const admin = await User.create({
    name: "FastSewa Admin",
    email: "admin@fastsewa.in",
    password: env.seedAdminPassword,
    role: "admin",
    permissions: ["*"],
    phone: "+91 90000 00000",
    businessName: "FastSewa",
  })

  const client = await User.create({
    name: "Arjun Mehta",
    email: "demo@fastsewa.in",
    password: env.seedClientPassword,
    role: "client",
    phone: "+91 98765 43210",
    businessName: "Mehta Enterprises",
    pan: "ABCPM1234D",
    gstin: "27ABCPM1234D1ZX",
    address: "123, MG Road, Mumbai, Maharashtra - 400001",
  })

  const services = await Service.find({
    code: { $in: ["svc-004", "svc-007", "svc-013"] },
  })

  const serviceByCode = Object.fromEntries(services.map((service) => [service.code, service]))

  await Order.insertMany([
    {
      orderNumber: "ORD-2026-0001",
      user: client._id,
      service: serviceByCode["svc-007"]._id,
      serviceSnapshot: {
        code: serviceByCode["svc-007"].code,
        category: serviceByCode["svc-007"].category,
        name: serviceByCode["svc-007"].name,
        description: serviceByCode["svc-007"].description,
        duration: serviceByCode["svc-007"].duration,
      },
      pricing: buildPricing(serviceByCode["svc-007"]),
      status: "completed",
      paymentStatus: "paid",
      assignedTo: "Priya Sharma",
      notes: "Application completed and GSTIN shared with the client.",
      documents: [{ name: "PAN Card.pdf", url: "" }],
      timeline: createInitialTimeline(true).map((step) => ({
        ...step,
        date: step.status === "Completed" ? new Date("2026-02-15") : new Date("2026-02-10"),
        done: true,
      })),
      createdAt: new Date("2026-02-10T10:30:00Z"),
      updatedAt: new Date("2026-02-15T14:00:00Z"),
    },
    {
      orderNumber: "ORD-2026-0002",
      user: client._id,
      service: serviceByCode["svc-004"]._id,
      serviceSnapshot: {
        code: serviceByCode["svc-004"].code,
        category: serviceByCode["svc-004"].category,
        name: serviceByCode["svc-004"].name,
        description: serviceByCode["svc-004"].description,
        duration: serviceByCode["svc-004"].duration,
      },
      pricing: buildPricing(serviceByCode["svc-004"]),
      status: "processing",
      paymentStatus: "paid",
      assignedTo: "Rahul Verma",
      notes: "Documents received. Return preparation is in progress.",
      documents: [{ name: "Financials.pdf", url: "" }],
      timeline: [
        { status: "Order placed", date: new Date("2026-03-01"), done: true },
        { status: "Payment received", date: new Date("2026-03-01"), done: true },
        { status: "Documents uploaded", date: new Date("2026-03-02"), done: true },
        { status: "Processing started", date: new Date("2026-03-03"), done: true },
        { status: "Completed", date: null, done: false },
      ],
      createdAt: new Date("2026-03-01T09:00:00Z"),
      updatedAt: new Date("2026-03-03T11:00:00Z"),
    },
    {
      orderNumber: "ORD-2026-0003",
      user: client._id,
      service: serviceByCode["svc-013"]._id,
      serviceSnapshot: {
        code: serviceByCode["svc-013"].code,
        category: serviceByCode["svc-013"].category,
        name: serviceByCode["svc-013"].name,
        description: serviceByCode["svc-013"].description,
        duration: serviceByCode["svc-013"].duration,
      },
      pricing: buildPricing(serviceByCode["svc-013"]),
      status: "pending",
      paymentStatus: "pending",
      notes: "",
      documents: [],
      timeline: createInitialTimeline(false),
      createdAt: new Date("2026-03-14T16:00:00Z"),
      updatedAt: new Date("2026-03-14T16:00:00Z"),
    },
  ])

  console.log("Database seeded successfully")
  console.log("Admin login: admin@fastsewa.in /", env.seedAdminPassword)
  console.log("Client login: demo@fastsewa.in /", env.seedClientPassword)
  console.log("Seeded by:", admin.email)
  process.exit(0)
}

seed().catch((error) => {
  console.error("Seed failed")
  console.error(error)
  process.exit(1)
})
