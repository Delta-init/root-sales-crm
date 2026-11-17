"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Copy, ExternalLink, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SalesTvBoard, type CsLabels } from "@/components/sales-tv/SalesTvBoard";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { SalesTvData, SalesTvFetcher } from "@/lib/salesTv";

/*
 * Mentors TV, signed in (the user, 2026-11-17: "a mentors revenue leaderboard — a separate link, not on the Sales TV or
 * the Manager TV"): each mentor's revenue this month — the course payments after their meetings ("Meeting
 * Conducted By", approved, AED) — and their meetings, Dubai or Bangalore. Root admins only. The office TVs use the
 * open link, /public/mentors-tv?location=…, the same without any email.
 */
const MENTOR_LABELS: CsLabels = { title: "Mentors", tone: "mentors", person: "Mentor", plural: "mentors", earned: "revenue", empty: "No mentor has a payment or a meeting this month yet." };
type Loc = "dubai" | "bangalore";
const LOCS: Array<{ key: Loc; label: string }> = [{ key: "dubai", label: "Dubai" }, { key: "bangalore", label: "Bangalore" }];

const fetcherFor = (location: Loc): SalesTvFetcher => async (since, month) => {
  const params = { location, ...(since ? { since } : {}), ...(month ? { month } : {}) };
  const { data } = await api.get<{ data: SalesTvData }>("/mentors-tv", { params });
  return data.data;
};

export default function MentorsTvPage() {
  const [location, setLocation] = useState<Loc>("dubai");
  const [link, setLink] = useState("");
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("location");
    if (asked === "bangalore") setLocation("bangalore");
  }, []);
  // The location and the month shown go with the link, so a TV opens on the same board.
  useEffect(() => {
    const at = () => {
      const month = new URLSearchParams(window.location.search).get("month");
      setLink(`${window.location.origin}/public/mentors-tv?location=${location}${month ? `&month=${month}` : ""}`);
    };
    at();
    window.addEventListener("tv-month", at);
    return () => window.removeEventListener("tv-month", at);
  }, [location]);
  const pick = (loc: Loc) => {
    const url = new URL(window.location.href);
    url.searchParams.set("location", loc);
    window.history.replaceState(null, "", url.toString());
    setLocation(loc);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Public link copied"); } catch { toast.message(link); }
  };

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <GraduationCap className="h-6 w-6 text-primary" /> Mentors TV
          </h2>
          <p className="mt-1 text-muted-foreground">
            Each mentor&apos;s revenue this month — the course payments after their meetings (&quot;Meeting Conducted By&quot;, approved by finance, AED) — with their meetings, and every new one announced. Open the public link on an office TV — no sign-in, no emails.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md border border-border p-0.5">
            {LOCS.map((l) => (
              <button key={l.key} type="button" onClick={() => pick(l.key)}
                className={cn("rounded px-3 py-1 text-sm font-medium", location === l.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {l.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={copy} disabled={!link}>
            <Copy className="h-4 w-4" /> Copy link
          </Button>
          <Button size="sm" asChild>
            <a href={link || "/public/mentors-tv"} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Open public link
            </a>
          </Button>
        </div>
      </motion.div>
      <SalesTvBoard key={location} fetcher={fetcherFor(location)} variant="embedded" withCs noCrms panels={false} months compactMoney
        csLabels={MENTOR_LABELS} title="Mentors TV" subtitle={`Revenue after their meetings · ${location === "bangalore" ? "Bangalore" : "Dubai"}`} />
    </div>
  );
}
