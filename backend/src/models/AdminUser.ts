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
    /*
     * root_admin launches into anything and administers the portal.
     * member launches into whatever their access rows allow, and nothing else.
     * viewer reads the group report and opens nothing.
     *
     * The default stays `viewer`, which is the least a new row can be. A
     * default of `member` would mean an account created carelessly could open
     * systems, and the safe default is the one that opens none.
     */
    role: {
      type: String,
      enum: ["root_admin", "member", "viewer"],
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
