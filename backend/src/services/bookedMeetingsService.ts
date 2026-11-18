import { callTarget, resolveTarget, httpError } from "../lib/targetClient.js";
import type { Period } from "./salespersonService.js";

/*
 * The meetings a person booked with the mentors (the user, 2026-11-18: "in the salesperson or CS page, a report of
 * the meetings they added and done"): asked of the LMS (GET /service/meetings-booked), by the address the person
 * books with — every kind, from any portal — with where each stands: upcoming, done, waiting for the mentor's
 * outcome (CS Portal's student meetings), cancelled. Read only.
 *
 * The page's period is cut in Gulf days and passed as days; none means the last 339 days and the coming 60 (the 400
 * days the LMS answers at most). A longer period is cut to its last 400 days, and says so.
 */
const DAY_MS = 86_400_000;
const MAX_DAYS = 400;
const gulfDay = (t: number) => new Date(t + 4 * 3_600_000).toISOString().slice(0, 10);

export async function bookedMeetings(email: string, period: Period) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(e)) throw httpError("Whose meetings? An email is needed", 400);
  const toMs = period.to ? period.to.getTime() : Date.now() + 60 * DAY_MS;
  let fromMs = period.from ? period.from.getTime() : Date.now() - 339 * DAY_MS;
  const clipped = toMs - fromMs > (MAX_DAYS - 1) * DAY_MS;
  if (clipped) fromMs = toMs - (MAX_DAYS - 1) * DAY_MS;
  const from = gulfDay(fromMs), to = gulfDay(toMs);
  const target = await resolveTarget("lms");
  const params = new URLSearchParams({ emails: e, from, to });
  try {
    const data = await callTarget<Record<string, unknown>>(target, `/meetings-booked?${params}`, { method: "GET", verb: "list the meetings booked" });
    return { ...data, email: e, from, to, clipped };
  } catch (err) {
    const msg = (err as Error).message ?? "";
    // An LMS from before this route.
    if (/404|not found/i.test(msg)) throw httpError("The LMS's server needs updating — it can't list the meetings someone booked yet", 409);
    throw err;
  }
}
