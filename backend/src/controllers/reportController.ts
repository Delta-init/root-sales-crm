import type { Response, NextFunction } from "express";
import { z } from "zod";
import * as groupReport from "../services/groupReportService.js";
import { record } from "../services/auditService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  granularity: z.enum(["day", "month"]).optional(),
});

const isValidDate = (d: Date) => !Number.isNaN(d.getTime());

interface ParsedQuery {
  range: groupReport.DateRange;
  granularity: "day" | "month";
}

const parseQuery = (query: unknown): ParsedQuery | { error: string } => {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return { error: "Invalid query parameters" };

  const { from, to, granularity } = parsed.data;

  const fromDate = from ? new Date(from) : undefined;
  if (fromDate && !isValidDate(fromDate)) return { error: `Invalid 'from' date: ${from}` };

  // A bare date means the whole of that day. Without pushing to end-of-day,
  // `to=2026-08-22` silently excludes everything after midnight.
  const toDate = to ? new Date(/T/.test(to) ? to : `${to}T23:59:59.999Z`) : undefined;
  if (toDate && !isValidDate(toDate)) return { error: `Invalid 'to' date: ${to}` };

  if (fromDate && toDate && fromDate > toDate) {
    return { error: "'from' is after 'to'" };
  }

  return { range: { from: fromDate, to: toDate }, granularity: granularity ?? "day" };
};

/** Shared wrapper: parse, run, respond — so each endpoint is one line of intent. */
const handler =
  (
    run: (q: ParsedQuery) => Promise<unknown>,
    message: string,
    audit?: string
  ) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const parsed = parseQuery(req.query);
    if ("error" in parsed) {
      sendError(res, parsed.error, 400);
      return;
    }
    try {
      const data = await run(parsed);
      if (audit) {
        await record(req, "report_view", {
          adminId: req.admin!.adminId,
          adminEmail: req.admin!.email,
          detail: audit,
        });
      }
      sendSuccess(res, message, data);
    } catch (error) {
      next(error);
    }
  };

export const overview = handler(
  (q) => groupReport.getOverview(q.range),
  "Group overview",
  "group overview"
);

export const timeline = handler(
  (q) => groupReport.getTimeline(q.range, q.granularity),
  "Group timeline"
);

export const sources = handler(
  (q) => groupReport.getSourcePerformance(q.range),
  "Source performance"
);
