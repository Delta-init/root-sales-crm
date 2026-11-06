"use client";

import { SalesTvBoard } from "@/components/sales-tv/SalesTvBoard";
import { TvMediaOverlay } from "@/components/tv-media/TvMediaOverlay";
import { API_URL } from "@/lib/axios";
import type { SalesTvData, SalesTvFetcher } from "@/lib/salesTv";

/*
 * The open Manager TV (the user, 2026-10-23): the Sales TV with the CS team as a fourth card, for the office TVs —
 * no sign-in. Asks the backend's GET /public/manager-tv (names, teams, counts, amounts, photos — never an email)
 * every few seconds; the backend's caches decide how often the CRMs and CS Portal are actually asked.
 */
const fetchPublic: SalesTvFetcher = async (since, month) => {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  if (month) params.set("month", month);
  const qs = params.size ? `?${params}` : "";
  const res = await fetch(`${API_URL}/public/manager-tv${qs}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { data?: SalesTvData; message?: string };
  if (!res.ok || !body.data) throw new Error(body.message ?? `Root answered ${res.status}`);
  return body.data;
};

export default function PublicManagerTvPage() {
  return (
    <>
      <SalesTvBoard fetcher={fetchPublic} variant="tv" withCs panels={false} months compactMoney title="Manager TV" subtitle="Team Cartel · Team Syndicate · Team Avengers · Team Mafia" />
      {/* The photos and videos chosen for this TV between the boards (2026-11-02). */}
      <TvMediaOverlay screen="root-manager-tv" />
    </>
  );
}
