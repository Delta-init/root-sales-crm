import type { Response, NextFunction } from "express";
import { callsByPerson, callsOverview, recordingLink, type CallFilters } from "../services/callsService.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

const KEYS = ["from", "to", "portal", "person", "direction", "result", "search", "sort", "order", "page", "limit"] as const;
const filtersOf = (q: Record<string, unknown>): CallFilters => {
  const f: CallFilters = {};
  for (const k of KEYS) if (typeof q[k] === "string") f[k] = String(q[k]).slice(0, 120);
  return f;
};

/** GET /calls — every portal's 3CX calls: totals, people, a page of calls. */
export const overview = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Calls", await callsOverview(filtersOf(req.query as Record<string, unknown>)));
  } catch (error) {
    next(error);
  }
};

/** GET /calls/:portal/:id/recording-link?index= — a link the browser plays the recording from. */
export const recording = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Recording link", await recordingLink(String(req.params.portal), String(req.params.id), req.query.index));
  } catch (error) {
    next(error);
  }
};

/** GET /pending/calls?from&to — each person's calls in a period (Dubai days; today by default). */
export const byPerson = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query as Record<string, unknown>;
    sendSuccess(res, "Calls by person", await callsByPerson({ from: typeof q.from === "string" ? q.from : "", to: typeof q.to === "string" ? q.to : "" }));
  } catch (error) {
    next(error);
  }
};
