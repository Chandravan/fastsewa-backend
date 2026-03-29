import mongoose from "mongoose"

const contactInquirySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 180,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    source: {
      type: String,
      trim: true,
      default: "website",
      maxlength: 80,
    },
    status: {
      type: String,
      enum: ["new", "in_progress", "closed"],
      default: "new",
    },
    adminNotes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000,
    },
    ipAddress: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120,
    },
    userAgent: {
      type: String,
      trim: true,
      default: "",
      maxlength: 400,
    },
  },
  {
    timestamps: true,
  }
)

contactInquirySchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  },
})

export const ContactInquiry = mongoose.model("ContactInquiry", contactInquirySchema)
