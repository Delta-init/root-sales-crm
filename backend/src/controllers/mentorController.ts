import type { Response, NextFunction } from "express";
import { mentorService } from "../services/mentorService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { record } from "../services/auditService.js";
import type { AuthenticatedRequest } from "../types/index.js";

/**
 * The academy's mentors across a window of days.
 *
 * The window comes from the screen rather than being fixed here: the same
 * answer serves a week at a glance and a fortnight being planned, and the LMS
 * caps how far it will go.
 */
export const mentorSchedule = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const from = typeof req.query["from"] === "string" ? req.query["from"] : undefined;
    const to = typeof req.query["to"] === "string" ? req.query["to"] : undefined;
    sendSuccess(res, "Mentor schedule", await mentorService.schedule({ from, to }));
  } catch (error) {
    next(error);
  }
};

/**
 * Book time with a mentor.
 *
 * Recorded here as well as there. The LMS keeps the meeting; this keeps who
 * arranged it, which is the question asked afterwards when somebody wants to
 * know why an hour was taken.
 */
export const scheduleMeeting = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const mentorEmail = String(b["mentorEmail"] ?? "").trim();
    if (!mentorEmail) { sendError(res, "Choose a mentor", 400); return; }

    const result = await mentorService.scheduleMeeting({
      mentorEmail,
      title: String(b["title"] ?? ""),
      kind: String(b["kind"] ?? ""),
      scheduledStart: String(b["scheduledStart"] ?? ""),
      durationMins: Number(b["durationMins"] ?? 0),
      meetingUrl: b["meetingUrl"] ? String(b["meetingUrl"]) : undefined,
      /* Taken as a list, filtered to the rows somebody actually filled in. A
         half-typed row left behind in the form is not a person to invite. */
      attendees: (Array.isArray(b["attendees"]) ? b["attendees"] : [])
        .map((a) => {
          const row = (a ?? {}) as { name?: unknown; email?: unknown };
          return { name: String(row.name ?? "").trim(), email: String(row.email ?? "").trim() };
        })
        .filter((a) => a.name.length > 0),
      notes: b["notes"] ? String(b["notes"]) : undefined,
      // Never taken from the request. Whoever is signed in is who booked it.
      bookedByEmail: req.admin!.impersonatedBy?.email ?? req.admin!.email,
    });

    await record(req, "mentor_meeting_booked", {
      adminId: req.admin!.impersonatedBy?.id ?? req.admin!.adminId,
      adminEmail: req.admin!.impersonatedBy?.email ?? req.admin!.email,
      org: "lms",
      detail: `Booked ${result.meeting.title} with ${mentorEmail} for ${result.meeting.startsAt}`,
    });

    sendSuccess(res, "Meeting booked", result);
  } catch (error) {
    next(error);
  }
};

/*
 * Who is asking, as the LMS needs to be told.
 *
 * Taken from the session every time and never from the request. While
 * impersonating, it is the root admin really at the keyboard — the person
 * whose name should sit against a moved meeting is the one who moved it.
 */
const actorOf = (req: AuthenticatedRequest) => ({
  actorEmail: req.admin!.impersonatedBy?.email ?? req.admin!.email,
  actorIsRootAdmin: req.admin!.role === "root_admin",
});

/** One meeting in full — only for whoever may change it. */
export const meetingDetail = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { meetingId } = req.params as { meetingId: string };
    sendSuccess(res, "Meeting", await mentorService.getMeeting({ meetingId, ...actorOf(req) }));
  } catch (error) {
    next(error);
  }
};

/** Move it, or change who is on it. */
export const updateMeeting = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { meetingId } = req.params as { meetingId: string };
    const b = (req.body ?? {}) as Record<string, unknown>;

    const attendees = Array.isArray(b["attendees"])
      ? (b["attendees"] as unknown[])
          .map((a) => {
            const row = (a ?? {}) as { name?: unknown; email?: unknown };
            return { name: String(row.name ?? "").trim(), email: String(row.email ?? "").trim() };
          })
          .filter((a) => a.name.length > 0)
      : undefined;

    const result = await mentorService.updateMeeting({
      meetingId,
      ...actorOf(req),
      ...(b["title"] !== undefined ? { title: String(b["title"]) } : {}),
      ...(b["kind"] !== undefined ? { kind: String(b["kind"]) } : {}),
      ...(b["scheduledStart"] !== undefined ? { scheduledStart: String(b["scheduledStart"]) } : {}),
      ...(b["durationMins"] !== undefined ? { durationMins: Number(b["durationMins"]) } : {}),
      ...(b["meetingUrl"] !== undefined ? { meetingUrl: String(b["meetingUrl"]) } : {}),
      ...(b["notes"] !== undefined ? { notes: String(b["notes"]) } : {}),
      ...(attendees ? { attendees } : {}),
    });

    await record(req, "mentor_meeting_changed", {
      adminId: req.admin!.impersonatedBy?.id ?? req.admin!.adminId,
      adminEmail: actorOf(req).actorEmail,
      org: "lms",
      detail: `Changed meeting ${meetingId}${result.notified ? " and told everybody" : ""}`,
    });

    sendSuccess(res, "Meeting updated", result);
  } catch (error) {
    next(error);
  }
};

/** Call it off. */
export const cancelMeeting = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { meetingId } = req.params as { meetingId: string };
    const result = await mentorService.cancelMeeting({ meetingId, ...actorOf(req) });

    await record(req, "mentor_meeting_cancelled", {
      adminId: req.admin!.impersonatedBy?.id ?? req.admin!.adminId,
      adminEmail: actorOf(req).actorEmail,
      org: "lms",
      detail: `Cancelled meeting ${meetingId} and told everybody`,
    });

    sendSuccess(res, "Meeting cancelled", result);
  } catch (error) {
    next(error);
  }
};
