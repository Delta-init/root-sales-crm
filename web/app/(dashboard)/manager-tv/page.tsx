"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Copy, ExternalLink, FileSpreadsheet, Loader2, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SalesTvBoard } from "@/components/sales-tv/SalesTvBoard";
import { api } from "@/lib/axios";
import type { SalesTvData, SalesTvFetcher } from "@/lib/salesTv";
import { downloadXlsx } from "@/lib/xlsx";
import { managerTvSheets, type ManagerTvExport } from "@/lib/managerTvExcel";

/*
 * Manager TV, signed in (the user, 2026-10-23): the Sales TV — Dubai Sales, Draw and Remote — with the CS team as
 * a fourth card, ranked as CS Portal's CS leaderboard ranks them (course payments collected this month).
 * Root admins only. The office TVs use the open link, /public/manager-tv, the same without any email.
 */
const fetchSignedIn: SalesTvFetcher = async (since, month) => {
  const params = { ...(since ? { since } : {}), ...(month ? { month } : {}) };
  const { data } = await api.get<{ data: SalesTvData }>("/manager-tv", { params: Object.keys(params).length ? params : undefined });
  return data.data;
};

export default function ManagerTvPage() {
  const [link, setLink] = useState("");
  // The month shown goes with the link (?month=), so a TV can be opened on a month gone by.
  useEffect(() => {
    const at = () => {
      const month = new URLSearchParams(window.location.search).get("month");
      setLink(`${window.location.origin}/public/manager-tv${month ? `?month=${month}` : ""}`);
    };
    at();
    window.addEventListener("tv-month", at);
    return () => window.removeEventListener("tv-month", at);
  }, []);

  // Export Excel (2026-11-25): the month on screen — an overview with the TV's figures, then a sheet per person with
  // their payments. Here only: the public link has none.
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    try {
      const month = new URLSearchParams(window.location.search).get("month");
      const { data } = await api.get<{ data: ManagerTvExport }>("/manager-tv/export", { params: month ? { month } : undefined, timeout: 120_000 });
      downloadXlsx(`manager-tv-${data.data.month}`, managerTvSheets(data.data));
      toast.success("Excel downloaded");
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "The export didn't work — try again");
    } finally {
      setExporting(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Public link copied");
    } catch {
      toast.message(link);
    }
  };

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <MonitorPlay className="h-6 w-6 text-primary" /> Manager TV
          </h2>
          <p className="mt-1 text-muted-foreground">
            Team Cartel (Dubai Sales), Team Syndicate (Draw), Team Avengers (Remote) and Team Mafia (CS) live — everyone, team leaders and Sales Managers too: closings and revenue, the CSs' course payments, calls, and every close and CS payment announced. Open the public link on an office TV — no sign-in, no emails.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Export Excel
          </Button>
          <Button variant="outline" size="sm" onClick={copy} disabled={!link}>
            <Copy className="h-4 w-4" /> Copy link
          </Button>
          <Button size="sm" asChild>
            <a href={link || "/public/manager-tv"} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Open public link
            </a>
          </Button>
        </div>
      </motion.div>
      <SalesTvBoard fetcher={fetchSignedIn} variant="embedded" withCs panels={false} months compactMoney title="Manager TV" subtitle="Team Cartel · Team Syndicate · Team Avengers · Team Mafia" />
    </div>
  );
}
