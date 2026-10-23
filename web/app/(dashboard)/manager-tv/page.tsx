"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Copy, ExternalLink, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SalesTvBoard } from "@/components/sales-tv/SalesTvBoard";
import { api } from "@/lib/axios";
import type { SalesTvData, SalesTvFetcher } from "@/lib/salesTv";

/*
 * Manager TV, signed in (the user, 2026-10-23): the Sales TV — Dubai Sales, Draw and Remote — with the CS team as
 * a fourth card, ranked as Tetra Commission's CS leaderboard ranks them (course payments collected this month).
 * Root admins only. The office TVs use the open link, /public/manager-tv, the same without any email.
 */
const fetchSignedIn: SalesTvFetcher = async (since) => {
  const { data } = await api.get<{ data: SalesTvData }>("/manager-tv", { params: since ? { since } : undefined });
  return data.data;
};

export default function ManagerTvPage() {
  const [link, setLink] = useState("");
  useEffect(() => setLink(`${window.location.origin}/public/manager-tv`), []);

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
            Dubai Sales, Draw, Remote and the CS team live — everyone, team leaders and Sales Managers too: closings and revenue, the CSs' course payments, calls, and every close and CS payment announced. Open the public link on an office TV — no sign-in, no emails.
          </p>
        </div>
        <div className="flex gap-2">
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
      <SalesTvBoard fetcher={fetchSignedIn} variant="embedded" withCs panels={false} title="Manager TV" subtitle="Dubai Sales · Draw · Remote · CS team" />
    </div>
  );
}
