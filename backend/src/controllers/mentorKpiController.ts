import type { Response, NextFunction } from "express";
import { z } from "zod";
import {
  approveDraft, currentMonth, discardDraft, mentorScores, overview, saveDraft, scores, startDraft, suggestTargets, validKpiMonth,
} from "../services/mentorKpiService.js";
import { record } from "../services/auditService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/* Mentor KPIs (2026-11-09): the plan kept in Root, and the points Root works out with it. Root admins only. */

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<void>;
const handle = (fn: Handler) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (error) {
    const e = error as { statusCode?: number; message?: string; problems?: string[] };
    if (e.statusCode) {
      sendError(res, e.message ?? "Refused", e.statusCode, e.problems ? { problems: e.problems } : undefined);
      return;
    }
    next(error);
  }
};
const who = (req: AuthenticatedRequest) => ({ adminId: req.admin!.adminId, email: req.admin!.email });

const WEIGHT = z.number().int().min(0).max(100);
const KEY = z.string().regex(/^[a-z0-9_]{1,40}$/);
const NAME = z.string().trim().min(1).max(60);
const TARGET = z.number().finite().min(0).max(10_000_000);
const roleTargets = z.record(z.string(), TARGET);
const draftSchema = z.object({
  from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "from is a month (YYYY-MM)"),
  categories: z.array(z.object({
    key: KEY, name: NAME, weight: WEIGHT,
    subs: z.array(z.object({
      key: KEY, name: NAME, weight: WEIGHT,
      kpis: z.array(z.object({ metric: z.string().min(1).max(60), weight: WEIGHT, mode: z.enum(["scored", "monitoring", "off"]) })).max(20),
    })).max(12),
  })).min(1).max(12),
  targets: z.object({ junior_mentor: roleTargets, senior_mentor: roleTargets, chief_mentor: roleTargets }),
  overrides: z.array(z.object({
    email: z.string().trim().email().max(200), name: z.string().max(120).default(""), metric: z.string().min(1).max(60),
    value: TARGET, reason: z.string().max(300).default(""),
  })).max(500).default([]),
  note: z.string().max(500).default(""),
});

export const getPlans = handle(async (_req, res) => {
  sendSuccess(res, "Mentor KPI plans", await overview());
});

export const postDraft = handle(async (req, res) => {
  const draft = await startDraft(who(req), req.body ?? {});
  await record(req, "mentor_kpi_plan_changed", { adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: `Draft started, from ${draft.from}` });
  sendSuccess(res, "Draft started", draft, 201);
});

export const putDraft = handle(async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    sendError(res, `${issue.path.join(".") || "plan"}: ${issue.message}`, 400);
    return;
  }
  const draft = await saveDraft(who(req), parsed.data);
  await record(req, "mentor_kpi_plan_changed", { adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: `Draft saved, from ${draft.from}` });
  sendSuccess(res, "Draft saved", draft);
});

export const postSuggest = handle(async (req, res) => {
  const out = await suggestTargets(who(req));
  await record(req, "mentor_kpi_plan_changed", {
    adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: `Targets suggested from ${out.months.join(", ")} (${out.suggested})`,
  });
  sendSuccess(res, "Targets suggested", out);
});

export const postApprove = handle(async (req, res) => {
  const plan = await approveDraft(who(req));
  await record(req, "mentor_kpi_plan_approved", { adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: `Approved, from ${plan.from}` });
  sendSuccess(res, "Plan approved", plan);
});

export const deleteDraft = handle(async (req, res) => {
  const out = await discardDraft();
  await record(req, "mentor_kpi_plan_changed", { adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: `Draft discarded, from ${out.from}` });
  sendSuccess(res, "Draft discarded", out);
});

export const getScores = handle(async (req, res) => {
  const month = req.query.month ?? currentMonth();
  if (!validKpiMonth(month)) {
    sendError(res, "month is YYYY-MM", 400);
    return;
  }
  sendSuccess(res, "Mentor scores", await scores(month));
});

export const getMentorScores = handle(async (req, res) => {
  const month = req.query.month ?? currentMonth();
  const email = typeof req.query.email === "string" ? req.query.email : "";
  if (!validKpiMonth(month) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError(res, "email and month (YYYY-MM) are required", 400);
    return;
  }
  sendSuccess(res, "Mentor's scores", await mentorScores(email, month));
});
