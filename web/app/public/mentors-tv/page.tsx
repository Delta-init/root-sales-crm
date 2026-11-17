"use client";

import { useEffect, useState } from "react";
import { SalesTvBoard, type CsLabels } from "@/components/sales-tv/SalesTvBoard";
import { TvMediaOverlay } from "@/components/tv-media/TvMediaOverlay";
import { API_URL } from "@/lib/axios";
import type { SalesTvData, SalesTvFetcher } from "@/lib/salesTv";

/*
 * The open Mentors TV (the user, 2026-11-17): each mentor's revenue this month — course payments after their meetings
 * — and their meetings, for the office TVs, no sign-in. ?location=dubai (default) or bangalore. Asks the backend's
 * GET /public/mentors-tv (names, roles, teams, amounts, photos — never an email) every few seconds; the backend's
 * cache decides how often CS Portal is actually asked.
 */
const LABELS: CsLabels = { title: "Mentors", tone: "mentors", person: "Mentor", plural: "mentors", earned: "revenue", empty: "No mentor has a payment or a meeting this month yet." };

const fetcherFor = (location: string): SalesTvFetcher => async (since, month) => {
  const params = new URLSearchParams({ location });
  if (since) params.set("since", since);
  if (month) params.set("month", month);
  const res = await fetch(`${API_URL}/public/mentors-tv?${params}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { data?: SalesTvData; message?: string };
  if (!res.ok || !body.data) throw new Error(body.message ?? `Root answered ${res.status}`);
  return body.data;
};

export default function PublicMentorsTvPage() {
  const [location, setLocation] = useState<string | null>(null);
  useEffect(() => { setLocation(new URLSearchParams(window.location.search).get("location") === "bangalore" ? "bangalore" : "dubai"); }, []);
  if (!location) return null;
  return (
    <>
      <SalesTvBoard fetcher={fetcherFor(location)} variant="tv" withCs noCrms panels={false} months compactMoney csLabels={LABELS}
        title="Mentors TV" subtitle={`Revenue after their meetings · ${location === "bangalore" ? "Bangalore" : "Dubai"}`} />
      {/* The photos and videos chosen for this TV between the boards (2026-11-02). */}
      <TvMediaOverlay screen="root-mentors-tv" />
    </>
  );
}
