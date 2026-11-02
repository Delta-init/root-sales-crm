"use client";

import Script from "next/script";
import { API_URL } from "@/lib/axios";

/**
 * The office TVs' photos and videos (2026-11-02): Root's own TV pages load the same overlay script as every other
 * portal's — it plays this screen's photos and videos, then the board for its minute, and again. Root admins choose
 * them on the TV media page. With nothing chosen, or Root unreachable, the board shows as before.
 */
export function TvMediaOverlay({ screen }: { screen: string }) {
  return <Script src={`${API_URL}/public/tv/overlay.js?screen=${encodeURIComponent(screen)}`} strategy="afterInteractive" />;
}
