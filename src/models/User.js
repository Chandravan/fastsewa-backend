import bcrypt from "bcryptjs"
import mongoose from "mongoose"
import {
  getDefaultPermissionsForRole,
  normalizeAdminPermissions,
} from "../constants/adminPermissions.js"

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    businessName: {
      type: String,
      trim: true,
    },
    pan: {
      type: String,
      trim: true,
      uppercase: true,
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
    },
    address: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    resetPasswordTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    role: {
      type: String,
      enum: ["client", "admin"],
      default: "client",
    },
    permissions: {
      type: [String],
      default() {
        return getDefaultPermissionsForRole(this.role)
      },
    },
    active: {
      type: Boolean,
      default: true,
    },
    disabledAt: {
      type: Date,
      default: null,
    },
    disabledReason: {
      type: String,
      trim: true,
      default: "",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
)

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) {
    return next()
  }

  this.password = await bcrypt.hash(this.password, 10)
  if (!this.isNew) {
    // Step back slightly so tokens issued in the same second remain valid.
    this.passwordChangedAt = new Date(Date.now() - 1000)
  }
  next()
})

userSchema.pre("save", function normalizeAdminState(next) {
  this.permissions = normalizeAdminPermissions(this.permissions, this.role, {
    fallbackToFull: this.role === "admin",
  })

  if (this.active === false) {
    this.disabledAt = this.disabledAt || new Date()
  } else {
    this.disabledAt = null
    this.disabledReason = ""
  }

  next()
})

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

userSchema.methods.changedPasswordAfter = function changedPasswordAfter(jwtIssuedAtSeconds) {
  if (!this.passwordChangedAt || !jwtIssuedAtSeconds) {
    return false
  }

  return this.passwordChangedAt.getTime() > jwtIssuedAtSeconds * 1000
}

userSchema.set("toJSON", {
  virtuals: true,
  transform(doc, ret) {
    ret.id = ret._id.toString()
    ret.permissions = normalizeAdminPermissions(ret.permissions, ret.role, {
      fallbackToFull: ret.role === "admin",
    })
    ret.active = ret.active !== false
    delete ret._id
    delete ret.__v
    delete ret.password
    delete ret.resetPasswordTokenHash
    delete ret.resetPasswordExpiresAt
    return ret
  },
})

export const User = mongoose.model("User", userSchema)
