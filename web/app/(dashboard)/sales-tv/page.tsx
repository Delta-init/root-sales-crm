"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Copy, ExternalLink, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SalesTvBoard } from "@/components/sales-tv/SalesTvBoard";
import { api } from "@/lib/axios";
import type { SalesTvData, SalesTvFetcher } from "@/lib/salesTv";

/*
 * Sales TV, signed in (the user, 2026-10-20): Dubai Sales, Draw and Remote on
 * one screen — closings and calls, who is on a break, and every close
 * celebrated with the amount and a sound. Root admins only (the API refuses
 * anybody else). The office TVs use the open link, /public/sales-tv, which
 * shows the same without any email.
 */
const fetchSignedIn: SalesTvFetcher = async (since) => {
  const { data } = await api.get<{ data: SalesTvData }>("/sales-tv", { params: since ? { since } : undefined });
  return data.data;
};

export default function SalesTvPage() {
  const [link, setLink] = useState("");
  useEffect(() => setLink(`${window.location.origin}/public/sales-tv`), []);

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
            <Tv className="h-6 w-6 text-primary" /> Sales TV
          </h2>
          <p className="mt-1 text-muted-foreground">
            Dubai Sales, Draw and Remote live: closings, calls, who is on a break, and every close announced. Open the public link on an office TV — no sign-in, no emails.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copy} disabled={!link}>
            <Copy className="h-4 w-4" /> Copy link
          </Button>
          <Button size="sm" asChild>
            <a href={link || "/public/sales-tv"} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Open public link
            </a>
          </Button>
        </div>
      </motion.div>
      <SalesTvBoard fetcher={fetchSignedIn} variant="embedded" />
    </div>
  );
}
