import { callTarget, resolveTarget, httpError } from "../lib/targetClient.js";

/**
 * When the academy's mentors are free, and what is already in the diary.
 *
 * The LMS is the only system that knows this, so this is a pass-through rather
 * than anything clever: it asks, checks the shape, and hands it on. Nothing is
 * cached — a calendar showing yesterday's bookings is worse than a calendar
 * that takes a second, and somebody is looking at this to decide whether a
 * slot is free.
 *
 * Read-only on purpose. Availability is edited in the LMS, where the people
 * whose time it is can see and change it; the write path there replaces a
 * mentor's whole schedule in one call, and reaching that from another system
 * is a good way to erase a week somebody spent arranging.
 */

export interface MentorClass {
  id: string;
  /** Null when the class belongs to another academy — the time is shared, the subject is not. */
  title: string | null;
  startsAt: string;
  durationMins: number;
  status: string;
  booked: number;
  capacity: number;
  mine: boolean;
}

export interface Mentor {
  id: string;
  name: string;
  email: string;
  /** Lent to this academy rather than belonging to it. */
  shared: boolean;
  slots: { dayOfWeek: number; startTime: string; endTime: string }[];
  classes: MentorClass[];
}

export interface MentorSchedule {
  /**
   * The zone the recurring slots are in, as the LMS reports it.
   *
   * Carried rather than assumed here. Those slots are stored as bare "HH:MM"
   * strings with no zone attached, so the only honest way to render them is to
   * be told which one they mean and to say so on the screen.
   */
  timezone: string;
  from: string;
  to: string;
  mentors: Mentor[];
}

/** Longest window the LMS will answer for, matched here so a request this
 *  portal allows is never one the far side refuses. */
const MAX_WINDOW_DAYS = 62;

export const mentorService = {
  async schedule(input: { from?: string; to?: string }): Promise<MentorSchedule> {
    const from = input.from ? new Date(input.from) : new Date();
    if (Number.isNaN(from.getTime())) throw httpError("from is not a date", 400);

    const to = input.to ? new Date(input.to) : new Date(from.getTime() + 7 * 864e5);
    if (Number.isNaN(to.getTime())) throw httpError("to is not a date", 400);
    if (to <= from) throw httpError("to must be after from", 400);
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 864e5) {
      throw httpError(`At most ${MAX_WINDOW_DAYS} days at a time`, 400);
    }

    // Mentors are an LMS idea; no other system in the registry has them.
    const target = await resolveTarget("lms");

    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (target.remoteOrgId) params.set("remoteOrgId", target.remoteOrgId);

    const data = await callTarget<MentorSchedule>(
      target,
      `/mentors?${params.toString()}`,
      { method: "GET", verb: "list its mentors" },
    );

    return {
      timezone: data.timezone || "",
      from: data.from || from.toISOString(),
      to: data.to || to.toISOString(),
      mentors: data.mentors ?? [],
    };
  },
};
