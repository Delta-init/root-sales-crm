import { resolveTarget, callTarget } from "../lib/targetClient.js";
import { targetConfig } from "../config/targets.js";

/*
 * Reports → Students (the user, 2026-10-29): the dates' class bookings — past, today and ahead — the most-booked
 * students and classes, who attended every class they booked, and the students who haven't signed in to the LMS for
 * 14 days, counted by their CS. As the LMS counts them (GET /service/student-report); Dubai days. Read-only.
 * One programme at a time when asked (forex, digital = Digital Marketing + AI, jura, none = no programme set).
 */
const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function studentReport(q: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const from = str(q.from), to = str(q.to), academy = str(q.academy).toLowerCase(), program = str(q.program).toLowerCase();
  if (!isDay(from) || !isDay(to)) throw httpError("from and to are days (YYYY-MM-DD)", 400);
  if (academy && academy !== "dubai" && academy !== "bangalore") throw httpError("academy is dubai or bangalore", 400);
  if (program && !["forex", "digital", "jura", "none"].includes(program)) throw httpError("program is forex, digital, jura or none", 400);
  const target = await resolveTarget("lms");
  const params = new URLSearchParams({ from, to });
  if (academy) params.set("academy", academy);
  if (program) params.set("program", program);
  try {
    const data = await callTarget<Record<string, unknown>>(target, `/student-report?${params}`, { method: "GET", verb: "share its students report" });
    // Where the LMS admin is, for the links ("" when its address is not set).
    return { ...data, appUrl: targetConfig("lms").appUrl.replace(/\/+$/, "") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    if (/404|not found/i.test(message)) throw httpError("The LMS server needs updating — it has no students report yet", 409);
    throw error;
  }
}
