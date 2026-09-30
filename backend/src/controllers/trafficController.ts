import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as traffic from "../services/trafficService.js";
import { record } from "../services/auditService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest, TrafficOrg } from "../types/index.js";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const ORG = z.enum(["delta", "draw"]);
const OBJECT_ID = /^[a-f\d]{24}$/i;

// ── The sheet ────────────────────────────────────────────────────────────────

/** The sheet's "Test connection": the key works, and whether routing is on. */
export const ping = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const view = await traffic.rulesView();
    sendSuccess(res, "Lead traffic is reachable", {
      paused: view.paused,
      crms: view.crms.map((c) => ({ code: c.code, name: c.name, ready: c.active && c.missing.length === 0 })),
    });
  } catch (error) {
    next(error);
  }
};

const intakeSchema = z.object({ rows: z.array(z.unknown()).min(1, "rows is empty").max(200, "At most 200 rows per request") });

export const intake = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = intakeSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, parsed.error.issues[0]?.message ?? "Invalid body", 400);
    return;
  }
  try {
    const result = await traffic.intake(parsed.data.rows);
    sendSuccess(res, `${parsed.data.rows.length} lead(s) taken`, result);
  } catch (error) {
    next(error);
  }
};

// ── Root admins ──────────────────────────────────────────────────────────────

export const getRules = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Lead traffic settings", await traffic.rulesView());
  } catch (error) {
    next(error);
  }
};

const shareSchema = z.object({
  org: ORG,
  percent: z.number().int("Whole percentages only").min(0).max(100),
  assignToId: z.string().regex(OBJECT_ID, "Not a user id").nullable(),
});
const rulesSchema = z.object({
  paused: z.boolean(),
  segments: z.object({ uk_gcc: z.array(shareSchema), hindi: z.array(shareSchema) }),
});

export const putRules = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const parsed = rulesSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, parsed.error.issues[0]?.message ?? "Invalid settings", 400);
    return;
  }
  try {
    const { changed } = await traffic.saveRule(parsed.data, { adminId: req.admin!.adminId, email: req.admin!.email });
    await record(req, "traffic_rules_changed", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      detail: changed,
    });
    sendSuccess(res, "Lead traffic settings saved", await traffic.rulesView());
  } catch (error) {
    next(error);
  }
};

export const summary = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const today = traffic.gulfToday();
  const from = req.query.from ? String(req.query.from) : today;
  const to = req.query.to ? String(req.query.to) : today;
  if (!DATE.safeParse(from).success || !DATE.safeParse(to).success) {
    sendError(res, "from and to must be YYYY-MM-DD", 400);
    return;
  }
  if (from > to) {
    sendError(res, "'from' is after 'to'", 400);
    return;
  }
  try {
    sendSuccess(res, "Lead traffic", await traffic.summary(from, to));
  } catch (error) {
    next(error);
  }
};

const leadsQuery = z.object({
  filter: z.enum(["all", "waiting", "failed", "sent", "duplicate", "invalid"]).default("all"),
  org: z.enum(["all", "delta", "draw"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const leads = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const parsed = leadsQuery.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, parsed.error.issues[0]?.message ?? "Invalid query", 400);
    return;
  }
  try {
    sendSuccess(res, "Leads", await traffic.listLeads(parsed.data));
  } catch (error) {
    next(error);
  }
};

export const retry = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await traffic.retryLead(req.params.id);
    await record(req, "traffic_lead_retried", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: doc.destination,
      detail: `${doc.name} → ${doc.destination}: ${doc.status}`,
    });
    sendSuccess(res, doc.status === "sent" ? "Sent" : `Tried — ${traffic.sheetLabel(doc)}`, {
      id: String(doc._id),
      status: doc.status,
      label: traffic.sheetLabel(doc),
      lastError: doc.lastError,
    });
  } catch (error) {
    next(error);
  }
};

export const crmUsers = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const code = ORG.safeParse(req.params.code);
  if (!code.success) {
    sendError(res, "Unknown CRM", 404);
    return;
  }
  try {
    sendSuccess(res, "People", await traffic.listCrmUsers(code.data as TrafficOrg));
  } catch (error) {
    next(error);
  }
};
