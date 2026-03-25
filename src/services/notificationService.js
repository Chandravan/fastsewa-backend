import nodemailer from "nodemailer"
import { env } from "../config/env.js"

let transporter = null

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount || 0))
}

function buildOrderUrl(order) {
  return new URL(`/dashboard/orders/${order.id}`, env.frontendUrl).toString()
}

function buildResetPasswordUrl(token) {
  const url = new URL("/reset-password", env.frontendUrl)
  url.searchParams.set("token", token)
  return url.toString()
}

function buildSupportLine() {
  return `Support: ${env.supportEmail}${env.supportWhatsappNumber ? ` | WhatsApp: +${env.supportWhatsappNumber}` : ""}`
}

function buildEmailHtml({ title, intro, detailRows = [], actionLabel = "", actionUrl = "", outro = "" }) {
  const rows = detailRows.map(({ label, value }) => (
    `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(value)}</td></tr>`
  )).join("")

  const actionBlock = actionLabel && actionUrl
    ? `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;margin-top:20px;padding:12px 18px;background:#f97316;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;">${escapeHtml(actionLabel)}</a>`
    : ""

  return `
    <div style="background:#f4f4f5;padding:32px 16px;font-family:Segoe UI,Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;padding:28px;border:1px solid #e5e7eb;">
        <p style="margin:0 0 10px;color:#f97316;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">FastSewa Notification</p>
        <h1 style="margin:0 0 12px;color:#111827;font-size:26px;line-height:1.2;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 20px;color:#4b5563;font-size:14px;line-height:1.7;">${escapeHtml(intro)}</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 12px;">${rows}</table>
        ${actionBlock}
        ${outro ? `<p style="margin:18px 0 0;color:#6b7280;font-size:13px;line-height:1.7;">${escapeHtml(outro)}</p>` : ""}
      </div>
    </div>
  `
}

function normalizeRecipients(input) {
  if (Array.isArray(input)) {
    return input.map((entry) => String(entry || "").trim()).filter(Boolean)
  }

  if (!input) {
    return []
  }

  return [String(input).trim()].filter(Boolean)
}

function getAdminRecipients() {
  const explicitRecipients = normalizeRecipients(env.adminAlertEmails)
  if (explicitRecipients.length > 0) {
    return explicitRecipients
  }

  return normalizeRecipients(env.supportEmail)
}

function isSmtpConfigured() {
  return Boolean(env.notificationsEnabled && env.smtpHost && env.smtpFrom)
}

function getTransporter() {
  if (!isSmtpConfigured()) {
    return null
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser
        ? {
            user: env.smtpUser,
            pass: env.smtpPass,
          }
        : undefined,
    })
  }

  return transporter
}

async function sendEmail({ to, subject, text, html }) {
  const recipients = normalizeRecipients(to)
  if (!env.notificationsEnabled || recipients.length === 0) {
    return { skipped: true, reason: "notifications-disabled-or-no-recipient" }
  }

  const mailer = getTransporter()
  if (!mailer) {
    console.info(`[notifications] skipped "${subject}" because SMTP is not configured`)
    return { skipped: true, reason: "smtp-not-configured" }
  }

  try {
    const info = await mailer.sendMail({
      from: env.smtpFrom,
      to: recipients.join(", "),
      replyTo: env.smtpReplyTo || undefined,
      subject,
      text,
      html,
    })

    console.info(`[notifications] delivered "${subject}" as ${info.messageId}`)
    return { delivered: true, messageId: info.messageId }
  } catch (error) {
    console.error(`[notifications] failed "${subject}"`, error)
    return { delivered: false, error }
  }
}

function resolveClient(order, fallbackUser = null) {
  return fallbackUser || order.user || {}
}

function getOrderCore(order) {
  return {
    orderNumber: order.orderNumber || order.id,
    serviceName: order.serviceSnapshot?.name || order.serviceName || "FastSewa Service",
    amount: order.pricing?.totalAmount || order.amount || 0,
    assignedTo: order.assignedTo || "FastSewa CA Team",
  }
}

export function queueNotification(label, task) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`[notifications] unexpected error in ${label}`, error)
    })
}

export async function sendWelcomeEmail({ user }) {
  const recipient = user?.email
  if (!recipient) {
    return
  }

  const subject = "Welcome to FastSewa"
  const intro = `Hi ${user.name || "there"}, your FastSewa account is ready. You can now place orders, upload documents, and track filings online.`
  const actionUrl = new URL("/dashboard", env.frontendUrl).toString()

  await sendEmail({
    to: recipient,
    subject,
    text: `${intro}\n\nOpen dashboard: ${actionUrl}\n${buildSupportLine()}`,
    html: buildEmailHtml({
      title: "Welcome to FastSewa",
      intro,
      detailRows: [
        { label: "Account", value: user.email },
        { label: "Role", value: user.role || "client" },
      ],
      actionLabel: "Open Dashboard",
      actionUrl,
      outro: buildSupportLine(),
    }),
  })
}

export async function sendPasswordResetEmail({ user, resetToken }) {
  if (!user?.email || !resetToken) {
    return { skipped: true, reason: "missing-user-or-token" }
  }

  const resetUrl = buildResetPasswordUrl(resetToken)
  const subject = "Reset your FastSewa password"
  const intro = `Hi ${user.name || "there"}, we received a request to reset your FastSewa password. This link will expire in ${env.passwordResetTokenTtlMinutes} minutes.`

  const emailResult = await sendEmail({
    to: user.email,
    subject,
    text: `${intro}\n\nReset password: ${resetUrl}\nIf you did not request this, you can safely ignore this email.\n${buildSupportLine()}`,
    html: buildEmailHtml({
      title: "Reset your password",
      intro,
      detailRows: [
        { label: "Account", value: user.email },
        { label: "Expires in", value: `${env.passwordResetTokenTtlMinutes} minutes` },
      ],
      actionLabel: "Reset Password",
      actionUrl: resetUrl,
      outro: `If you did not request this, you can safely ignore this email. ${buildSupportLine()}`,
    }),
  })

  return {
    ...emailResult,
    resetUrl,
  }
}

export async function sendPasswordChangedEmail({ user }) {
  if (!user?.email) {
    return
  }

  const subject = "Your FastSewa password was changed"
  const intro = `Hi ${user.name || "there"}, your FastSewa password was changed successfully. If this was not you, contact support immediately.`
  const actionUrl = new URL("/login", env.frontendUrl).toString()

  await sendEmail({
    to: user.email,
    subject,
    text: `${intro}\n\nSign in: ${actionUrl}\n${buildSupportLine()}`,
    html: buildEmailHtml({
      title: "Password changed successfully",
      intro,
      detailRows: [
        { label: "Account", value: user.email },
      ],
      actionLabel: "Sign In",
      actionUrl,
      outro: buildSupportLine(),
    }),
  })
}

export async function sendOrderCreatedNotifications({ order, user }) {
  const client = resolveClient(order, user)
  const orderCore = getOrderCore(order)
  const orderUrl = buildOrderUrl(order)

  await Promise.allSettled([
    sendEmail({
      to: client.email,
      subject: `Order received: ${orderCore.orderNumber}`,
      text: `Hi ${client.name || "there"}, we have received your order ${orderCore.orderNumber} for ${orderCore.serviceName}. Total amount: ${formatCurrency(orderCore.amount)}.\n\nTrack order: ${orderUrl}\n${buildSupportLine()}`,
      html: buildEmailHtml({
        title: "Your order has been received",
        intro: `Hi ${client.name || "there"}, we have received your FastSewa order and our team is ready to process it.`,
        detailRows: [
          { label: "Order", value: orderCore.orderNumber },
          { label: "Service", value: orderCore.serviceName },
          { label: "Amount", value: formatCurrency(orderCore.amount) },
          { label: "Payment", value: order.paymentStatus || "pending" },
        ],
        actionLabel: "Track Order",
        actionUrl: orderUrl,
        outro: buildSupportLine(),
      }),
    }),
    sendEmail({
      to: getAdminRecipients(),
      subject: `Admin alert: new order ${orderCore.orderNumber}`,
      text: `New order received.\nOrder: ${orderCore.orderNumber}\nService: ${orderCore.serviceName}\nClient: ${client.name || "Unknown"} (${client.email || "no-email"})\nAmount: ${formatCurrency(orderCore.amount)}\nTrack: ${orderUrl}`,
      html: buildEmailHtml({
        title: "New order received",
        intro: "A new order has landed in the FastSewa pipeline.",
        detailRows: [
          { label: "Order", value: orderCore.orderNumber },
          { label: "Service", value: orderCore.serviceName },
          { label: "Client", value: `${client.name || "Unknown"} (${client.email || "no-email"})` },
          { label: "Amount", value: formatCurrency(orderCore.amount) },
        ],
        actionLabel: "Open Order",
        actionUrl: orderUrl,
      }),
    }),
  ])
}

export async function sendPaymentSuccessNotifications({ order, user }) {
  const client = resolveClient(order, user)
  const orderCore = getOrderCore(order)
  const orderUrl = buildOrderUrl(order)

  await Promise.allSettled([
    sendEmail({
      to: client.email,
      subject: `Payment confirmed: ${orderCore.orderNumber}`,
      text: `Hi ${client.name || "there"}, payment has been confirmed for ${orderCore.orderNumber}. Your order is now moving forward.\n\nService: ${orderCore.serviceName}\nAmount paid: ${formatCurrency(orderCore.amount)}\nTrack order: ${orderUrl}\n${buildSupportLine()}`,
      html: buildEmailHtml({
        title: "Payment confirmed",
        intro: `Payment has been confirmed for your FastSewa order and processing is now underway.`,
        detailRows: [
          { label: "Order", value: orderCore.orderNumber },
          { label: "Service", value: orderCore.serviceName },
          { label: "Amount paid", value: formatCurrency(orderCore.amount) },
          { label: "Assigned to", value: orderCore.assignedTo },
        ],
        actionLabel: "Track Order",
        actionUrl: orderUrl,
        outro: buildSupportLine(),
      }),
    }),
    sendEmail({
      to: getAdminRecipients(),
      subject: `Admin alert: payment received for ${orderCore.orderNumber}`,
      text: `Payment confirmed.\nOrder: ${orderCore.orderNumber}\nClient: ${client.name || "Unknown"} (${client.email || "no-email"})\nAmount: ${formatCurrency(orderCore.amount)}\nTrack: ${orderUrl}`,
      html: buildEmailHtml({
        title: "Payment received",
        intro: "A FastSewa order payment has been confirmed.",
        detailRows: [
          { label: "Order", value: orderCore.orderNumber },
          { label: "Client", value: `${client.name || "Unknown"} (${client.email || "no-email"})` },
          { label: "Amount", value: formatCurrency(orderCore.amount) },
          { label: "Assigned to", value: orderCore.assignedTo },
        ],
        actionLabel: "Open Order",
        actionUrl: orderUrl,
      }),
    }),
  ])
}

export async function sendOrderUpdateNotifications({ order, user, previousState }) {
  const client = resolveClient(order, user)
  if (!client.email) {
    return
  }

  const orderCore = getOrderCore(order)
  const orderUrl = buildOrderUrl(order)
  const changes = []

  if (previousState.status !== order.status) {
    changes.push(`Order status changed from ${previousState.status} to ${order.status}`)
  }

  const paidJustNow = previousState.paymentStatus !== "paid" && order.paymentStatus === "paid"
  if (previousState.paymentStatus !== order.paymentStatus && !paidJustNow) {
    changes.push(`Payment status changed from ${previousState.paymentStatus} to ${order.paymentStatus}`)
  }

  if ((previousState.assignedTo || "") !== (order.assignedTo || "")) {
    changes.push(`Assigned CA updated to ${order.assignedTo || "Not assigned yet"}`)
  }

  if ((previousState.notes || "").trim() !== (order.notes || "").trim() && order.notes) {
    changes.push(`Latest update: ${order.notes}`)
  }

  if (changes.length === 0) {
    return
  }

  await sendEmail({
    to: client.email,
    subject: `Order update: ${orderCore.orderNumber}`,
    text: `Hi ${client.name || "there"}, there is an update on your FastSewa order ${orderCore.orderNumber}.\n\n${changes.join("\n")}\n\nTrack order: ${orderUrl}\n${buildSupportLine()}`,
    html: buildEmailHtml({
      title: "Your order was updated",
      intro: `There is a fresh update on your FastSewa order. Here is what changed:`,
      detailRows: changes.map((change, index) => ({ label: `Update ${index + 1}`, value: change })),
      actionLabel: "View Order",
      actionUrl: orderUrl,
      outro: buildSupportLine(),
    }),
  })
}
