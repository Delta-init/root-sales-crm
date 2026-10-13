import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";
import { matchCrmLeads } from "../services/crmLeadMatchService.js";

/*
 * POST /service/crm-leads — the LMS asking which sales CRMs its students are
 * leads in. A POST, so emails and phone numbers never sit in a URL or a log
 * line. At most 100 people a call; an email or phone that is blank or not one
 * simply matches nothing.
 */
const body = z.object({
  people: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    email: z.string().max(320).optional().nullable(),
    phone: z.string().max(200).optional().nullable(),
  })).min(1).max(100),
});

export const crmLeads = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "Validation failed — send { people: [{ id, email?, phone? }] }, 1 to 100 of them", 400, z.treeifyError(parsed.error));
    return;
  }
  try {
    const people = parsed.data.people.map((p) => ({ id: p.id, email: p.email ?? undefined, phone: p.phone ?? undefined }));
    sendSuccess(res, "CRM leads", await matchCrmLeads(people));
  } catch (error) {
    next(error);
  }
};
