import mongoose from "mongoose"

const timelineItemSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      default: null,
    },
    done: {
      type: Boolean,
      default: false,
    },
    note: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
)

const documentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      trim: true,
      default: "",
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
)

const paymentAuditSchema = new mongoose.Schema(
  {
    fromStatus: {
      type: String,
      trim: true,
      default: "",
    },
    toStatus: {
      type: String,
      trim: true,
      default: "",
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    source: {
      type: String,
      trim: true,
      default: "Manual admin verification",
    },
    trackingId: {
      type: String,
      trim: true,
      default: "",
    },
    bankRefNo: {
      type: String,
      trim: true,
      default: "",
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    changedBySnapshot: {
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
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
)

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },
    serviceSnapshot: {
      code: String,
      category: String,
      name: String,
      description: String,
      duration: String,
    },
    pricing: {
      baseAmount: {
        type: Number,
        required: true,
      },
      discountPercent: {
        type: Number,
        default: 0,
      },
      discountAmount: {
        type: Number,
        default: 0,
      },
      finalAmount: {
        type: Number,
        required: true,
      },
      gstRate: {
        type: Number,
        default: 18,
      },
      gstAmount: {
        type: Number,
        required: true,
      },
      totalAmount: {
        type: Number,
        required: true,
      },
    },
    payment: {
      gateway: {
        type: String,
        trim: true,
        default: "ccavenue",
      },
      merchantOrderId: {
        type: String,
        trim: true,
        default: "",
      },
      attemptId: {
        type: String,
        trim: true,
        default: "",
      },
      attemptStatus: {
        type: String,
        enum: ["none", "initiated", "verification_pending", "success", "failed", "cancelled", "expired"],
        default: "none",
      },
      gatewayStatus: {
        type: String,
        trim: true,
        default: "",
      },
      trackingId: {
        type: String,
        trim: true,
        default: "",
      },
      bankRefNo: {
        type: String,
        trim: true,
        default: "",
      },
      paymentMode: {
        type: String,
        trim: true,
        default: "",
      },
      cardName: {
        type: String,
        trim: true,
        default: "",
      },
      currency: {
        type: String,
        trim: true,
        default: "INR",
      },
      initiatedAt: {
        type: Date,
        default: null,
      },
      attemptStartedAt: {
        type: Date,
        default: null,
      },
      attemptExpiresAt: {
        type: Date,
        default: null,
      },
      lastCallbackAt: {
        type: Date,
        default: null,
      },
      completedAt: {
        type: Date,
        default: null,
      },
      statusMessage: {
        type: String,
        trim: true,
        default: "",
      },
      rawResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
      auditTrail: {
        type: [paymentAuditSchema],
        default: [],
      },
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "cancelled"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "verification_pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    assignedTo: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    documents: {
      type: [documentSchema],
      default: [],
    },
    timeline: {
      type: [timelineItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

orderSchema.virtual("amount").get(function amount() {
  return this.pricing.finalAmount
})

orderSchema.set("toJSON", {
  virtuals: true,
  transform(doc, ret) {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  },
})

export const Order = mongoose.model("Order", orderSchema)
