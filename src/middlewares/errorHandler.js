export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500

  if (res.headersSent) {
    return next(err)
  }

  res.status(statusCode).json({
    message: err.message || "Internal server error",
    details: err.details || null,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  })
}
