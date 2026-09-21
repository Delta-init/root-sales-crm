import type { Response, NextFunction } from "express";
import { mentorService } from "../services/mentorService.js";
import { sendSuccess } from "../utils/response.js";
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
