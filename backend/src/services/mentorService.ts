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

export interface MentorMeeting {
  id: string;
  title: string;
  kind: string;
  startsAt: string;
  durationMins: number;
  /** Names only — the calendar says who, not how to reach them. */
  attendeeNames: string[];
  /** Who arranged it; the screen decides from this who may change it. */
  bookedByEmail: string;
}

export interface Mentor {
  id: string;
  name: string;
  email: string;
  /** Lent to this academy rather than belonging to it. */
  shared: boolean;
  slots: { dayOfWeek: number; startTime: string; endTime: string }[];
  classes: MentorClass[];
  /** Time booked with them that is not a class. */
  meetings: MentorMeeting[];
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
      mentors: (data.mentors ?? []).map((m) => ({ ...m, meetings: m.meetings ?? [] })),
    };
  },

  /**
   * Book time with a mentor.
   *
   * Passed through rather than decided here. Whether the hour is free, whether
   * the mentor belongs to this academy, whether a joining link can be made —
   * all of that is the LMS's to answer, and answering any of it here would be a
   * second opinion that goes stale the moment somebody books through the LMS
   * instead.
   *
   * Who booked it travels with the request. The LMS has no idea who is signed
   * in to this portal, and a meeting nobody can be traced to is one nobody can
   * be asked about.
   */
  async scheduleMeeting(input: {
    mentorEmail: string;
    title: string;
    kind: string;
    scheduledStart: string;
    durationMins: number;
    meetingUrl?: string;
    attendees: { name: string; email?: string }[];
    notes?: string;
    bookedByEmail: string;
  }): Promise<{ meeting: MentorMeeting & { meetingUrl: string }; linkNote: string | null }> {
    const target = await resolveTarget("lms");

    return callTarget(target, "/mentor-meetings", {
      method: "POST",
      verb: "book that meeting",
      body: { ...input, remoteOrgId: target.remoteOrgId || undefined },
    });
  },

  /**
   * One meeting in full, for whoever may change it.
   *
   * Who is asking is sent along, because the LMS has no idea who is signed in
   * here and the answer depends on it — the person who arranged this hour, or
   * somebody who administers the portal. Everybody else is told it does not
   * exist rather than that they may not look, which is the same answer they
   * would get for a meeting in another academy.
   */
  async getMeeting(input: { meetingId: string; actorEmail: string; actorIsRootAdmin: boolean }) {
    const target = await resolveTarget("lms");
    const params = new URLSearchParams({
      actorEmail: input.actorEmail,
      actorIsRootAdmin: String(input.actorIsRootAdmin),
    });
    if (target.remoteOrgId) params.set("remoteOrgId", target.remoteOrgId);

    return callTarget<{
      id: string; title: string; kind: string; startsAt: string; durationMins: number;
      meetingUrl: string; notes: string; bookedByEmail: string;
      mentorEmail: string; mentorName: string; timezone: string;
      attendees: { name: string; email: string }[];
    }>(target, `/mentor-meetings/${encodeURIComponent(input.meetingId)}?${params.toString()}`,
      { method: "GET", verb: "describe that meeting" });
  },

  /** Move it, or change who is on it. */
  async updateMeeting(input: Record<string, unknown> & { meetingId: string }) {
    const target = await resolveTarget("lms");
    const { meetingId, ...rest } = input;
    return callTarget<{ id: string; notified: boolean }>(
      target, `/mentor-meetings/${encodeURIComponent(meetingId)}`,
      { method: "PATCH", verb: "change that meeting",
        body: { ...rest, remoteOrgId: target.remoteOrgId || undefined } },
    );
  },

  /** Call it off. */
  async cancelMeeting(input: { meetingId: string; actorEmail: string; actorIsRootAdmin: boolean }) {
    const target = await resolveTarget("lms");
    return callTarget<{ id: string; cancelled: boolean }>(
      target, `/mentor-meetings/${encodeURIComponent(input.meetingId)}/cancel`,
      { method: "POST", verb: "cancel that meeting",
        body: {
          actorEmail: input.actorEmail,
          actorIsRootAdmin: input.actorIsRootAdmin,
          remoteOrgId: target.remoteOrgId || undefined,
        } },
    );
  },
};
