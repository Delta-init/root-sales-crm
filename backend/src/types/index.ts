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

/**
 * What somebody who is not a root admin may do on the Lead traffic page.
 * `view` sees the split and the leads; `manage` also changes the split and
 * sends a stuck lead by hand. Root admins can do both whatever this says.
 */
export type TrafficAccess = "none" | "view" | "manage";

export interface IAdminUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: AdminRole;
  status: "active" | "inactive";
  trafficAccess: TrafficAccess;
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
  | "hrms"
  | "lms"
  | "media-erp"
  | "commission";

/**
 * What kind of system a registered target is.
 *
 * The registry began as a list of CRMs, and everything in it was one. It is now
 * the list of everywhere a person can be sent — the CRMs, the two finance
 * organizations, HRMS, the LMS and the media ERP — and those behave
 * differently enough that the code has to know which it is holding: a CRM is
 * scoped to the people who work in it, HRMS is somewhere everyone belongs, and
 * finance has no Draw at all.
 */
export type TargetKind = "crm" | "finance" | "hrms" | "lms" | "erp" | "commission";

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
/**
 * What a role in one system makes somebody in another.
 *
 * A BDE in a sales CRM is a salesperson in finance — a fact about the business
 * that was being retyped on every grant, and therefore retyped differently.
 */
export interface IRoleMap extends Document {
  _id: Types.ObjectId;
  fromTarget: TargetCode;
  /** Lowercased for matching; `label` keeps what somebody actually typed. */
  fromRole: string;
  label: string;
  toTarget: TargetCode;
  /** Spelled as the far system spells it — sent there verbatim. */
  toRole: string;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

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
  /*
   * How to reach this system is not here — see config/targets.ts. The
   * addresses, database URI and shared secret come from the environment, so
   * nothing on this document opens anything.
   */
  timezone: string;
  currency: string;
  /** Multiplier to BASE_CURRENCY. 1 for orgs already in the base currency. */
  fxToBase: number;
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
  // Looking at the portal as somebody else, and going through a door while
  // doing it. Two actions rather than one: starting is a decision, and each
  // launch is a separate thing done while wearing the face.
  | "impersonation_started"
  | "impersonation_launch"
  // An hour taken in somebody else's week, arranged from here.
  | "mentor_meeting_booked"
  | "mentor_meeting_changed"
  | "mentor_meeting_cancelled"
  // Work raised in another system, from here.
  | "task_created"
  | "task_approved"
  | "task_returned"
  | "task_verified"
  | "task_rejected"
  | "target_registered"
  | "target_updated"
  | "account_provisioned"
  | "people_imported"
  | "role_map_changed"
  | "account_deactivated"
  | "account_deleted"
  // Lead traffic: the split decides which CRM every sheet lead lands in, so
  // who changed it, and who pushed a stuck lead through by hand, is recorded.
  | "traffic_rules_changed"
  | "traffic_lead_retried"
  | "traffic_access_changed";

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
  /**
   * Who was really at the keyboard, when it was not the person in `admin`.
   *
   * Under impersonation `admin` is the account being looked at, because that
   * is genuinely whose session opened the door. This is the only field that
   * remembers it was somebody else's hand, and the row is the portal's own
   * record — the far side will record the subject and nothing more.
   */
  impersonatedByEmail?: string;
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

// ─── Lead traffic ─────────────────────────────────────────────────────────────
/** A lead sheet that posts into lead traffic. Each has its own split. */
export type TrafficSheet = "abhin" | "shoaib";

/** The CRMs a lead can be sent to. Registry codes, so names and addresses come from there. */
export type TrafficOrg = "delta" | "draw";

/**
 * One team's share of a segment: where its leads go, and how many of them.
 *
 * Named, and counted by `key`, because two teams can sit in the same CRM — the
 * Delta sales team's pool, and the Dilshad team whose leads go straight to
 * Nusra in Delta until it has a CRM of its own.
 */
export interface TrafficShare {
  key: string;
  name: string;
  org: TrafficOrg;
  /** Percent of the segment, to two decimals; a segment's shares add up to 100. */
  percent: number;
  /** One person in that CRM who takes this team's leads; null lets the CRM share them out. */
  assignTo: { id: string; name: string } | null;
}

/**
 * A part of a sheet split on its own — a tab, or the whole sheet.
 *
 * `version` moves on when one of its percentages changes, and its split is
 * counted within one version, so changing Hindi does not restart UK's count.
 */
export interface TrafficSegmentRule {
  key: string;
  label: string;
  version: number;
  shares: TrafficShare[];
}

export interface ITrafficRule extends Document {
  /** The sheet this is the split for. */
  key: TrafficSheet;
  paused: boolean;
  segments: TrafficSegmentRule[];
  /** The CRM user recorded as having added each lead; blank lets the CRM choose. */
  reporters: { delta: string; draw: string };
  updatedBy: Types.ObjectId | null;
  updatedByEmail: string;
}

export type TrafficStatus =
  | "queued"
  | "held"
  | "sending"
  | "sent"
  | "duplicate"
  | "invalid"
  | "retrying"
  | "failed";

export interface ITrafficLead extends Document {
  _id: Types.ObjectId;
  /** Which sheet it came from. */
  sheet: TrafficSheet;
  /** Meta's lead id when the sheet has one; what makes a resend the same lead. */
  sourceKey: string;
  metaId: string;
  tab: string;
  /** Its segment within the sheet (uk, gcc, hindi — or all, for a sheet split as one). */
  segment: string;
  source: string;
  name: string;
  phone: string;
  /** The last nine digits: the same person, however the number was typed. */
  phone9: string;
  email: string;
  platform: string;
  campaign: string;
  adName: string;
  /** The ad set, and the lead's answer to the form's trading-knowledge question, when the sheet has them. */
  adset: string;
  knowledge: string;
  isOrganic: boolean;
  createdTime: Date | null;
  /** The team the split gave it to; blank when it went where the person already was. */
  share: string;
  destination: TrafficOrg | null;
  /** How the destination was chosen: the split, or where the person already is. */
  reason: "split" | "known" | "invalid";
  /** Whether it took a place in the split; duplicates and rejects do not. */
  counted: boolean;
  /** The segment's version when it was decided. */
  ruleVersion: number;
  assignTo: { id: string; name: string } | null;
  status: TrafficStatus;
  crmLeadId: string;
  note: string;
  attempts: number;
  nextAttemptAt: Date | null;
  claimedAt: Date | null;
  lastError: string;
  sentAt: Date | null;
  receivedAt: Date;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface JwtPayload {
  adminId: string;
  email: string;
  role: AdminRole;
  /**
   * Set only while a root admin is looking at the portal as somebody else.
   *
   * The rest of this payload is the person being impersonated — the whole
   * point is that everything downstream treats the session as theirs without
   * being told about impersonation at all. This is the one claim that says
   * otherwise, and it exists so the audit trail can name who was really at
   * the keyboard.
   *
   * Note what it does NOT do: `role` is re-read from the database on every
   * request, so this cannot be used to hold powers the impersonated account
   * does not have. Wearing somebody's face means having only their reach.
   */
  impersonatedBy?: { id: string; email: string };
  /** Read from the record on every request, like the role — never from the token. */
  trafficAccess?: TrafficAccess;
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
