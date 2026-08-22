import type { Request } from "express";
import type { Document, Types } from "mongoose";

// ─── API envelope (matches the three CRMs) ────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: unknown;
}

// ─── Admin ────────────────────────────────────────────────────────────────────
export type AdminRole = "root_admin" | "viewer";

export interface IAdminUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: AdminRole;
  status: "active" | "inactive";
  lastLoginAt: Date | null;
  comparePassword(candidate: string): Promise<boolean>;
}

// ─── Organization ─────────────────────────────────────────────────────────────
export type OrgCode = "delta" | "banglore" | "draw";

export interface IOrganization extends Document {
  _id: Types.ObjectId;
  code: OrgCode;
  name: string;
  appUrl: string;
  apiUrl: string;
  /** Read-only connection string, used by the group report only. */
  mongoUri: string;
  timezone: string;
  currency: string;
  /** Multiplier to BASE_CURRENCY. 1 for orgs already in the base currency. */
  fxToBase: number;
  /** Email of the dedicated service account the portal signs in as. */
  serviceEmail: string;
  /** Shared secret for this org's SSO endpoint. Never sent to the browser. */
  ssoSecret: string;
  accent: string;
  /** Earliest lead in this org's data — the group report uses it so short-lived
   *  orgs are not silently compared against Delta's much longer history. */
  dataStartsAt: Date | null;
  isActive: boolean;
  sortOrder: number;
}

// ─── Audit log ────────────────────────────────────────────────────────────────
export type AuditAction =
  | "login"
  | "login_failed"
  | "logout"
  | "sso_launch"
  | "sso_launch_failed"
  | "report_view";

export interface IAuditLog extends Document {
  admin: Types.ObjectId | null;
  adminEmail: string;
  action: AuditAction;
  org: OrgCode | null;
  ip: string;
  userAgent: string;
  detail: string;
}

// ─── SSO handoff ──────────────────────────────────────────────────────────────
export interface ISsoToken extends Document {
  token: string;
  admin: Types.ObjectId;
  adminEmail: string;
  org: OrgCode;
  subjectEmail: string;
  subjectName: string;
  expiresAt: Date;
  usedAt: Date | null;
  issuedToIp: string;
}

// ─── Daily tracker ────────────────────────────────────────────────────────────
export interface ITrackerTarget extends Document {
  org: OrgCode;
  metrics: Map<string, number>;
  updatedBy: Types.ObjectId | null;
}

export interface IDailyEntry extends Document {
  org: OrgCode;
  userId: string;
  userName: string;
  date: string;
  metrics: Map<string, number>;
  remarks: string;
  actionRequired: string;
  updatedBy: Types.ObjectId | null;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface JwtPayload {
  adminId: string;
  email: string;
  role: AdminRole;
}

export interface AuthenticatedRequest extends Request {
  admin?: JwtPayload;
}
