"use client";

import { useEffect, useState } from "react";
import { SalesTvBoard, type CsLabels } from "@/components/sales-tv/SalesTvBoard";
import { TvMediaOverlay } from "@/components/tv-media/TvMediaOverlay";
import { API_URL } from "@/lib/axios";
import type { SalesTvData, SalesTvFetcher } from "@/lib/salesTv";

/*
 * The open CS & Mentors TV (the user, 2026-11-18: "split screen — one side CS and one side mentors, and the team leaders
 * too"): the CS on the left — what each collected this month, as the office CS TV counts it — and the mentors on the
 * right — their revenue after their meetings — each with its teams and their leaders under it. ?location=dubai
 * (default) or bangalore. Asks the backend's GET /public/cs-mentors-tv (names, teams, amounts, photos — never an email)
 * every few seconds; the backend's cache decides how often CS Portal is actually asked.
 */
const CS: CsLabels = { title: "CS", tone: "cs", person: "CS", plural: "CSs", earned: "collected", empty: "No CS has a payment this month yet." };
const MENTORS: CsLabels = { title: "Mentors", tone: "mentors", person: "Mentor", plural: "mentors", earned: "revenue", empty: "No mentor has a payment or a meeting this month yet." };

const fetcherFor = (location: string): SalesTvFetcher => async (since, month) => {
  const params = new URLSearchParams({ location });
  if (since) params.set("since", since);
  if (month) params.set("month", month);
  const res = await fetch(`${API_URL}/public/cs-mentors-tv?${params}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { data?: SalesTvData; message?: string };
  if (!res.ok || !body.data) throw new Error(body.message ?? `Root answered ${res.status}`);
  return body.data;
};

export default function PublicCsMentorsTvPage() {
  const [location, setLocation] = useState<string | null>(null);
  useEffect(() => { setLocation(new URLSearchParams(window.location.search).get("location") === "bangalore" ? "bangalore" : "dubai"); }, []);
  if (!location) return null;
  return (
    <>
      <SalesTvBoard fetcher={fetcherFor(location)} variant="tv" withCs withMentors teamStrip noCrms panels={false} months compactMoney
        csLabels={CS} mentorLabels={MENTORS} title="CS & Mentors TV" subtitle={location === "bangalore" ? "Bangalore" : "Dubai"} />
      {/* The photos and videos chosen for this TV between the boards (2026-11-02). */}
      <TvMediaOverlay screen="root-cs-mentors-tv" />
    </>
  );
}
