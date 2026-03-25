import cors from "cors"
import express from "express"
import morgan from "morgan"
import { env } from "./config/env.js"
import { errorHandler } from "./middlewares/errorHandler.js"
import { notFound } from "./middlewares/notFound.js"
import { apiRouter } from "./routes/index.js"

export const app = express()
const allowedOrigins = new Set(env.corsOrigins)

function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/+$/, "")
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true)
      return
    }

    callback(null, allowedOrigins.has(normalizeOrigin(origin)))
  },
  credentials: true,
}))
app.use(express.json({ limit: "1mb" }))
app.use(express.urlencoded({ extended: true }))
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"))

app.get("/api/health", (req, res) => {
  res.json({
    message: "FastSewa API is healthy",
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  })
})

app.use("/api", apiRouter)
app.use(notFound)
app.use(errorHandler)
