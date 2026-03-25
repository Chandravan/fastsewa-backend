import mongoose from "mongoose"

function slugifyText(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const serviceSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    basePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    discountPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    duration: {
      type: String,
      default: "3-5 working days",
    },
    documents: {
      type: [String],
      default: [],
    },
    popular: {
      type: Boolean,
      default: false,
    },
    icon: {
      type: String,
      default: "file-text",
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

serviceSchema.pre("validate", function buildSlug(next) {
  if (!this.slug && this.name) {
    this.slug = slugifyText(this.name)
  }
  next()
})

serviceSchema.virtual("discountAmount").get(function discountAmount() {
  return Math.round(this.basePrice * (this.discountPercent / 100))
})

serviceSchema.virtual("finalPrice").get(function finalPrice() {
  return Math.max(0, this.basePrice - this.discountAmount)
})

serviceSchema.virtual("price").get(function price() {
  return this.finalPrice
})

serviceSchema.set("toJSON", {
  virtuals: true,
  transform(doc, ret) {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  },
})

export const Service = mongoose.model("Service", serviceSchema)
