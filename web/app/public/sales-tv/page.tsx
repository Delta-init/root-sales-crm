"use client";

import { SalesTvBoard } from "@/components/sales-tv/SalesTvBoard";
import { API_URL } from "@/lib/axios";
import type { SalesTvData, SalesTvFetcher } from "@/lib/salesTv";

/*
 * The open Sales TV (the user, 2026-10-20): for the office TVs, no sign-in.
 * Asks the backend's GET /public/sales-tv — names, teams, counts, break photos
 * and close amounts, never an email — every few seconds; the backend's cache
 * decides how often the CRMs are actually asked, however many screens there are.
 */
const fetchPublic: SalesTvFetcher = async (since) => {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await fetch(`${API_URL}/public/sales-tv${qs}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { data?: SalesTvData; message?: string };
  if (!res.ok || !body.data) throw new Error(body.message ?? `Root answered ${res.status}`);
  return body.data;
};

export default function PublicSalesTvPage() {
  return <SalesTvBoard fetcher={fetchPublic} variant="tv" />;
}
