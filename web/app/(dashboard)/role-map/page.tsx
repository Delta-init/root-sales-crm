"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Plus, Shuffle, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import type { RoleRule, Target } from "@/lib/types";

/**
 * What a role in one system makes somebody in another.
 *
 * A BDE in a sales CRM is a salesperson in finance. That is a fact about how
 * this business is organised, and before this it was retyped on every grant —
 * which means retyped differently, and a role spelled "Salesperson" where
 * finance calls it "salesperson" is a grant that fails at the far end after
 * everybody has gone home.
 *
 * Rules rather than a convention baked into the code: "BDE means salesperson"
 * looks obvious enough to hard-code right until somebody adds "BDE II", and a
 * convention has no answer for that one — it maps to nothing, quietly.
 */
export default function RoleMapPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ fromTarget: "", fromRole: "", toTarget: "", toRole: "" });
  const [error, setError] = useState("");

  const rules = useQuery({
    queryKey: ["role-map"],
    queryFn: async () => (await api.get<{ data: RoleRule[] }>("/access/role-map")).data.data,
  });
  const targets = useQuery({
    queryKey: ["access", "targets"],
    queryFn: async () => (await api.get<{ data: Target[] }>("/access/targets")).data.data,
  });

  const nameOf = (code: string) =>
    targets.data?.find((t) => t.code === code)?.name ?? code;

  const add = useMutation({
    mutationFn: async () => api.post("/access/role-map", draft),
    onSuccess: () => {
      setDraft({ fromTarget: "", fromRole: "", toTarget: "", toRole: "" });
      setError("");
      void qc.invalidateQueries({ queryKey: ["role-map"] });
    },
    onError: (e: unknown) => {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "That rule could not be saved",
      );
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/access/role-map/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["role-map"] }),
  });

  const ready = draft.fromTarget && draft.fromRole.trim() && draft.toTarget && draft.toRole.trim();

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2">
          <Shuffle className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Role map</h1>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What somebody&apos;s role in one system makes them in another
        </p>
      </motion.div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-xs text-muted-foreground">
            When somebody is given the role on the left, they also get the one on the right. A role
            they have already been given something else for is left alone — a rule should not undo
            a decision somebody made on purpose.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[150px] flex-1 space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">In this system</label>
              <select
                value={draft.fromTarget}
                onChange={(e) => setDraft({ ...draft, fromTarget: e.target.value })}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">Choose…</option>
                {targets.data?.map((t) => (
                  <option key={t.code} value={t.code}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[130px] flex-1 space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Being a…</label>
              <Input
                value={draft.fromRole}
                onChange={(e) => setDraft({ ...draft, fromRole: e.target.value })}
                placeholder="BDE"
              />
            </div>

            <ArrowRight className="mb-2 h-4 w-4 shrink-0 text-muted-foreground" />

            <div className="min-w-[150px] flex-1 space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Also means, in</label>
              <select
                value={draft.toTarget}
                onChange={(e) => setDraft({ ...draft, toTarget: e.target.value })}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">Choose…</option>
                {targets.data
                  ?.filter((t) => t.code !== draft.fromTarget)
                  .map((t) => (
                    <option key={t.code} value={t.code}>{t.name}</option>
                  ))}
              </select>
            </div>
            <div className="min-w-[130px] flex-1 space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Being a…</label>
              <Input
                value={draft.toRole}
                onChange={(e) => setDraft({ ...draft, toRole: e.target.value })}
                placeholder="salesperson"
              />
            </div>

            <Button
              className="mb-0 gap-1.5"
              disabled={!ready || add.isPending}
              onClick={() => add.mutate()}
            >
              {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </Button>
          </div>

          {/* Spelled the way the far system spells it, because it is sent
              there as typed and a capital letter is a grant that fails. */}
          {draft.toTarget && (
            <p className="text-[11px] text-muted-foreground">
              Spell the role on the right exactly as {nameOf(draft.toTarget)} spells it — it is sent
              there as typed.
            </p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </CardContent>
      </Card>

      {rules.isLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : (rules.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Shuffle className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">No rules yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every grant asks for the role each time until there is one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.data?.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{r.fromRole}</span> in{" "}
                  {nameOf(r.fromTarget)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{r.toRole}</span> in{" "}
                  {nameOf(r.toTarget)}
                </span>
                <button
                  onClick={() => remove.mutate(r.id)}
                  title="Remove this rule"
                  className="ml-auto text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
