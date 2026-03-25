import { connectDB } from "./config/db.js"
import { env } from "./config/env.js"
import { app } from "./app.js"

async function startServer() {
  try {
    await connectDB()
    app.listen(env.port, () => {
      console.log(`FastSewa API running on http://localhost:${env.port}`)
    })
  } catch (error) {
    console.error("Failed to start server")
    console.error(error)
    process.exit(1)
  }
}

startServer()
