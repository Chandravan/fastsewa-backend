import mongoose from "mongoose"

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorSnapshot: {
      name: {
        type: String,
        trim: true,
        default: "",
      },
      email: {
        type: String,
        trim: true,
        default: "",
      },
      role: {
        type: String,
        trim: true,
        default: "",
      },
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    entityType: {
      type: String,
      enum: ["order", "service", "user", "system"],
      default: "system",
    },
    entityId: {
      type: String,
      trim: true,
      default: "",
    },
    entityLabel: {
      type: String,
      trim: true,
      default: "",
    },
    summary: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    ipAddress: {
      type: String,
      trim: true,
      default: "",
    },
    userAgent: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
)

auditLogSchema.index({ createdAt: -1 })
auditLogSchema.index({ entityType: 1, createdAt: -1 })
auditLogSchema.index({ actor: 1, createdAt: -1 })

auditLogSchema.set("toJSON", {
  virtuals: true,
  transform(doc, ret) {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  },
})

export const AuditLog = mongoose.model("AuditLog", auditLogSchema)
