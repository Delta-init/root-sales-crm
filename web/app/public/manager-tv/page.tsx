"use client";

import { SalesTvBoard } from "@/components/sales-tv/SalesTvBoard";
import { API_URL } from "@/lib/axios";
import type { SalesTvData, SalesTvFetcher } from "@/lib/salesTv";

/*
 * The open Manager TV (the user, 2026-10-23): the Sales TV with the CS team as a fourth card, for the office TVs —
 * no sign-in. Asks the backend's GET /public/manager-tv (names, teams, counts, amounts, photos — never an email)
 * every few seconds; the backend's caches decide how often the CRMs and Tetra Commission are actually asked.
 */
const fetchPublic: SalesTvFetcher = async (since) => {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await fetch(`${API_URL}/public/manager-tv${qs}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { data?: SalesTvData; message?: string };
  if (!res.ok || !body.data) throw new Error(body.message ?? `Root answered ${res.status}`);
  return body.data;
};

export default function PublicManagerTvPage() {
  return <SalesTvBoard fetcher={fetchPublic} variant="tv" withCs panels={false} title="Manager TV" subtitle="Dubai Sales · Draw · Remote · CS team" />;
}
