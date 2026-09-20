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
/**
 * What somebody is in the portal itself.
 *
 * `member` is new, and is most people: a rep or a counsellor who signs in here
 * and opens the systems they have been given. They administer nothing — what
 * they may reach is the access rows a root admin wrote for them.
 *
 * `viewer` is kept rather than folded into `member` because the two are not the
 * same thing: a viewer reads the group report and opens nothing, which is what
 * somebody in head office wants, and quietly upgrading them to a member would
 * hand them doors nobody decided to give them.
 */
export type AdminRole = "root_admin" | "member" | "viewer";

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
export type OrgCode =
  | "delta"
  | "banglore"
  | "draw"
  | "finance-hq"
  | "finance-banglore"
  | "hrms";

/**
 * What kind of system a registered target is.
 *
 * The registry began as a list of CRMs, and everything in it was one. It is now
 * the list of everywhere a person can be sent — the CRMs, the two finance
 * organizations, and HRMS — and those behave differently enough that the code
 * has to know which it is holding: a CRM is scoped to the people who work in
 * it, HRMS is somewhere everyone belongs, and finance has no Draw at all.
 */
export type TargetKind = "crm" | "finance" | "hrms";

/**
 * Somewhere a person may be sent.
 *
 * The same code the registry uses, deliberately: an access row points at a
 * registered target, and giving the two separate vocabularies would mean a
 * translation nobody reads and a rename that only half lands. The three CRM
 * codes are the ones already in the database and are left alone — the reports
 * and the three CRMs all know them.
 */
export type TargetCode = OrgCode;

/**
 * One person's right to open one thing.
 *
 * Listed, never derived. Somebody who works in the Banglore CRM must not turn
 * up in Delta's, and the way to be sure of that is for every door a person may
 * open to be a row somebody put there — not a rule that infers it from a role,
 * a name or an email domain, each of which is one rename away from being wrong.
 */
export interface IAccess extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  target: TargetCode;
  /**
   * What they are once they arrive, in that system's own vocabulary.
   *
   * A BDE in a CRM is a salesperson in finance. The translation is recorded
   * here rather than worked out on the way in, because a convention that maps
   * "BDE" to "salesperson" reads as obvious right up until somebody adds
   * "BDE II" and it quietly maps to nothing at all.
   */
  roleInTarget: string;
  grantedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrganization extends Document {
  _id: Types.ObjectId;
  code: OrgCode;
  name: string;
  /** What kind of system this is — see TargetKind. Older rows are CRMs. */
  kind: TargetKind;
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
  /** Which organization this target is inside the system it points at. */
  remoteOrgId: string;
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
  | "report_view"
  // A grant is the moment somebody gains reach into another system, and the
  // question asked afterwards is who opened the door and when.
  | "access_granted"
  | "access_revoked"
  | "portal_role_changed"
  | "target_registered"
  | "target_updated"
  | "account_provisioned"
  | "people_imported";

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
  texts: Map<string, string>;
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

/** A sales rep's session. Distinct from an admin's — `kind` is what stops an
 *  admin token being used on rep routes and vice versa. */
export interface RepJwtPayload {
  kind: "rep";
  repId: string;
  orgCode: OrgCode;
  email: string;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  admin?: JwtPayload;
  /** Set when a CRM backend authenticates with its org's service secret. */
  serviceOrg?: { code: string; name: string; timezone: string; currency: string };
  rep?: {
    repId: string;
    name: string;
    email: string;
    org: { code: string; name: string; timezone: string; currency: string };
  };
}
