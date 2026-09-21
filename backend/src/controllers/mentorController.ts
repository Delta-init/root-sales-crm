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
