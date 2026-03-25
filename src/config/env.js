import dotenv from "dotenv"

dotenv.config()

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/fastsewa",
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  passwordResetTokenTtlMinutes: Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES) || 30,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  frontendUrl: process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "http://localhost:5173",
  backendPublicUrl: process.env.BACKEND_PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 5000}`,
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || "password123",
  seedClientPassword: process.env.SEED_CLIENT_PASSWORD || "password123",
  notificationsEnabled: process.env.NOTIFICATIONS_ENABLED !== "false",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "",
  smtpReplyTo: process.env.SMTP_REPLY_TO || "",
  supportEmail: process.env.SUPPORT_EMAIL || "support@fastsewa.in",
  supportWhatsappNumber: process.env.SUPPORT_WHATSAPP_NUMBER || "919876543210",
  adminAlertEmails: (process.env.ADMIN_ALERT_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean),
  ccavenueMerchantId: process.env.CCAVENUE_MERCHANT_ID || "",
  ccavenueAccessCode: process.env.CCAVENUE_ACCESS_CODE || "",
  ccavenueWorkingKey: process.env.CCAVENUE_WORKING_KEY || "",
  ccavenueMode: process.env.CCAVENUE_MODE || "test",
}
