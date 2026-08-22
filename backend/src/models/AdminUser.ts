import mongoose, { Schema } from "mongoose";
import bcrypt from "bcryptjs";
import type { IAdminUser } from "../types/index.js";

const adminUserSchema = new Schema<IAdminUser>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    // root_admin can launch into any CRM; viewer sees the group report only.
    role: {
      type: String,
      enum: ["root_admin", "viewer"],
      default: "viewer",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

adminUserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

adminUserSchema.methods.comparePassword = async function (
  candidate: string
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

adminUserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete (ret as Partial<IAdminUser>).password;
    return ret;
  },
});

export const AdminUser = mongoose.model<IAdminUser>("AdminUser", adminUserSchema);
