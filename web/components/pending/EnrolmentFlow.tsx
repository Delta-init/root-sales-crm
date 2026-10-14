"use client";

import { Fragment, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronRight, CircleCheck, Flag, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { EnrolmentFlow as Flow, FlowClose, FlowCounts, FlowRole, FlowStep, FlowWaitingOn } from "@/lib/types";

/*
 * The enrolment workflow, every sales CRM (the user, 2026-10-14): each CRM's
 * My Enrolments steps as one chart — how many unfinished closes stand at each
 * step and who that step is on — the biggest pile first, who holds the most,
 * and the closes themselves (pick a step or a person to narrow them).
 */

export const STEP_LABEL: Record<FlowStep, string> = {
  finance: "Finance approved",
  lms: "LMS account",
  cs: "CS assigned",
  onboarded: "Onboarded",
  bonus: "MT5 bonus",
};
const STEP_OWNER: Record<FlowStep, string> = {
  finance: "accounts · sent back: the salesperson",
  lms: "the LMS",
  cs: "Tetra Commission's CS managers",
  onboarded: "their CS — the welcome",
  bonus: "a broker admin · or their CS logs the MT5",
};
export const ROLE_LABEL: Record<FlowRole, string> = {
  finance: "Finance — accounts to approve",
  salesperson: "Salesperson — sent back to correct",
  lms: "The LMS — making the account",
  cs_manager: "CS managers — no CS given yet",
  cs: "CS",
  broker_admin: "Broker admins — the MT5 bonus",
  tetra: "Tetra Commission — on its way, or no answer",
};
const STEPS: FlowStep[] = ["finance", "lms", "cs", "onboarded", "bonus"];

const daysSince = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = Math.floor((Date.now() - t) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
};
export const whoLabel = (w: { role: FlowRole; name: string }) =>
  w.role === "cs" ? `CS · ${w.name || "no name"}` : w.role === "salesperson" ? `Salesperson · ${w.name || "—"}` : ROLE_LABEL[w.role];

export function EnrolmentFlowView({ flow }: { flow: Flow }) {
  const [portal, setPortal] = useState("all");
  const [step, setStep] = useState<FlowStep | null>(null);
  const [who, setWho] = useState<string | null>(null);

  const p = flow.portals.find((x) => x.code === portal);
  const counts: FlowCounts = portal === "all" ? flow.all : p?.counts ?? flow.all;
  // Banglore's closes go only as far as the LMS.
  const steps = portal === "banglore" ? STEPS.slice(0, 2) : STEPS;
  const open = useMemo(() => flow.open.filter((c) => portal === "all" || c.portal === portal), [flow.open, portal]);
  const waitingOn = useMemo(() => flow.waitingOn
    .map((w) => ({ ...w, count: portal === "all" ? w.count : w.portals[portal] ?? 0 }))
    .filter((w) => w.count > 0)
    .sort((a, b) => b.count - a.count), [flow.waitingOn, portal]);
  const keyOf = (c: FlowClose) => {
    const r = c.waitingOn.role;
    if (r === "cs") return `cs:${c.waitingOn.name.toLowerCase()}`;
    if (r === "salesperson") return `salesperson:${c.closedBy.email || c.waitingOn.name.toLowerCase()}`;
    return r;
  };
  const shown = open.filter((c) => (!step || c.stage === step) && (!who || keyOf(c) === who));
  const atStep = (k: FlowStep) => counts.atStep[k].waiting + counts.atStep[k].failed;
  const biggest = steps.reduce<FlowStep | null>((best, k) => (atStep(k) > (best ? atStep(best) : 0) ? k : best), null);
  const topWho = waitingOn[0];

  return (
    <div className="space-y-4">
      {/* Which CRM */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sales CRM">
        <Button size="sm" variant={portal === "all" ? "default" : "outline"} onClick={() => { setPortal("all"); setStep(null); setWho(null); }}>
          All CRMs <span className="ml-1 rounded-full bg-background/30 px-1.5 text-xs tabular-nums">{flow.all.open}</span>
        </Button>
        {flow.portals.map((x) => (
          <Button key={x.code} size="sm" variant={portal === x.code ? "default" : "outline"} onClick={() => { setPortal(x.code); setStep(null); setWho(null); }} className="gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: x.accent || "hsl(var(--primary))" }} />
            {x.name}
            {x.available ? <span className="rounded-full bg-background/30 px-1.5 text-xs tabular-nums">{x.counts.open}</span> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
          </Button>
        ))}
      </div>
      {flow.portals.filter((x) => !x.available || !x.financeAnswered).map((x) => (
        <div key={x.code} className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{x.name}</span>{" "}
            {x.available ? "— finance could not be asked just now, so steps after the close show as unknown." : `could not be read — ${x.error}`}
          </span>
        </div>
      ))}

      {/* The chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Where the {counts.open} unfinished enrolment{counts.open === 1 ? "" : "s"} stand</CardTitle>
          {biggest && atStep(biggest) > 0 && (
            <p className="text-sm">
              <Flag className="mr-1 inline h-4 w-4 text-rose-500" />
              Most pending: <span className="font-semibold">{STEP_LABEL[biggest]}</span> — {atStep(biggest)} waiting on {STEP_OWNER[biggest]}
              {topWho ? <> · the most on one desk: <span className="font-semibold">{whoLabel(topWho)}</span> ({topWho.count})</> : null}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-stretch gap-2">
            <FlowBox title="Closed" value={counts.total} hint="handed to finance" tone="muted" />
            {steps.map((k) => (
              <Fragment key={k}>
                <ChevronRight className="hidden h-5 w-5 self-center text-muted-foreground sm:block" />
                <FlowBox
                  title={STEP_LABEL[k]}
                  value={atStep(k)}
                  hint={`on ${STEP_OWNER[k]}`}
                  failed={counts.atStep[k].failed}
                  failedLabel={k === "finance" ? "sent back / refused" : k === "bonus" ? "turned down" : "failed"}
                  tone={k === biggest && atStep(k) > 0 ? "hot" : atStep(k) ? "warm" : "muted"}
                  active={step === k}
                  onClick={() => setStep(step === k ? null : k)}
                />
              </Fragment>
            ))}
            <ChevronRight className="hidden h-5 w-5 self-center text-muted-foreground sm:block" />
            <FlowBox title="Done" value={counts.finished} hint="every step finished" tone="done" icon />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Each box counts the closes stopped at that step now — pick one to list them. Banglore&apos;s go only as far as the LMS (no Tetra Commission).
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        {/* Who holds them */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Waiting on whom</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {waitingOn.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Nothing is waiting.</p> : waitingOn.map((w) => (
              <WhoBar key={w.key} w={w} max={waitingOn[0]!.count} active={who === w.key} onClick={() => setWho(who === w.key ? null : w.key)} />
            ))}
          </CardContent>
        </Card>

        {/* The closes */}
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Unfinished enrolments · {shown.length}
              {step && <Badge variant="outline" className="gap-1">{STEP_LABEL[step]}<button type="button" onClick={() => setStep(null)} aria-label="All steps"><X className="h-3 w-3" /></button></Badge>}
              {who && <Badge variant="outline" className="gap-1">{whoLabel(waitingOn.find((w) => w.key === who) ?? { role: "tetra", name: "" })}<button type="button" onClick={() => setWho(null)} aria-label="Everyone"><X className="h-3 w-3" /></button></Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {shown.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">None.</p> : (
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Student</th>
                      <th className="pb-2 pr-3 font-medium">CRM · closed by</th>
                      <th className="pb-2 pr-3 font-medium">Steps</th>
                      <th className="pb-2 pr-3 font-medium">Stands at</th>
                      <th className="pb-2 pr-3 font-medium">Waiting on</th>
                      <th className="pb-2 text-right font-medium">Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={`${c.portal}:${c.id}`} className="border-b border-border/20 align-top last:border-0">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{c.name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{[c.enrollmentNumber, c.course, c.invoiceNumber].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="py-2 pr-3">
                          <div>{c.portalName}</div>
                          <div className="text-xs text-muted-foreground">{c.closedBy.name || "—"}{c.team ? ` · ${c.team}` : ""}</div>
                        </td>
                        <td className="py-2 pr-3"><StepDots steps={c.steps} /></td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className={cn("py-0 text-[11px]", c.stageState === "failed" ? "border-rose-500/40 text-rose-500" : "border-amber-500/40 text-amber-500")}>
                            {STEP_LABEL[c.stage]}
                          </Badge>
                          {c.detail && <div className="mt-0.5 max-w-[280px] text-xs text-muted-foreground">{c.detail}</div>}
                        </td>
                        <td className="py-2 pr-3 text-xs">{whoLabel(c.waitingOn)}</td>
                        <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums text-muted-foreground">{daysSince(c.since || c.closedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FlowBox({ title, value, hint, failed = 0, failedLabel, tone, active, onClick, icon }: {
  title: string; value: number; hint: string; failed?: number; failedLabel?: string;
  tone: "muted" | "warm" | "hot" | "done"; active?: boolean; onClick?: () => void; icon?: boolean;
}) {
  const tones = {
    muted: "border-border/60 bg-muted/20",
    warm: "border-amber-500/40 bg-amber-500/5",
    hot: "border-rose-500/60 bg-rose-500/10 ring-1 ring-rose-500/40",
    done: "border-emerald-500/40 bg-emerald-500/5",
  }[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="min-w-[132px] flex-1">
      <Tag
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={cn("flex h-full w-full flex-col rounded-lg border p-3 text-left transition-colors", tones, onClick && "hover:bg-muted/40", active && "outline outline-2 outline-primary")}
      >
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{icon && <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />}{title}</span>
        <span className={cn("mt-1 text-2xl font-bold tabular-nums", tone === "hot" && "text-rose-500", tone === "done" && "text-emerald-500")}>{value}</span>
        {failed > 0 && <span className="text-xs text-rose-500">{failed} {failedLabel}</span>}
        <span className="mt-auto pt-1 text-[11px] leading-snug text-muted-foreground">{hint}</span>
      </Tag>
    </motion.div>
  );
}

function WhoBar({ w, max, active, onClick }: { w: FlowWaitingOn; max: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50", active && "bg-primary/10")}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{whoLabel(w)}</span>
        <span className="font-semibold tabular-nums">{w.count}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", w.role === "salesperson" ? "bg-rose-500" : w.role === "finance" ? "bg-sky-500" : w.role === "broker_admin" ? "bg-violet-500" : "bg-amber-500")}
          style={{ width: `${Math.max(4, Math.round((w.count / Math.max(1, max)) * 100))}%` }} />
      </div>
    </button>
  );
}

/** The five steps as dots: green done, amber waiting, red failed, grey not needed or unknown. */
function StepDots({ steps }: { steps: FlowClose["steps"] }) {
  return (
    <span className="flex items-center gap-1">
      {steps.map((s) => (
        <span key={s.key} title={`${STEP_LABEL[s.key]}: ${s.state}`}
          className={cn("h-2.5 w-2.5 rounded-full",
            s.state === "done" ? "bg-emerald-500" : s.state === "waiting" ? "bg-amber-500" : s.state === "failed" ? "bg-rose-500" : "bg-muted-foreground/30")} />
      ))}
    </span>
  );
}

/**
 * The CSEs pages' share of the workflow (2026-10-14): the enrolments waiting on a CS — the welcome to send, the MT5
 * to log (or a bonus turned down) — and those waiting for a CS at all. A CS is matched by name, as the sales CRMs
 * know them from Tetra Commission. `only` narrows to one CSE.
 */
export function CseEnrolments({ flow, only }: { flow: Flow; only?: string }) {
  const name = (only ?? "").trim().toLowerCase();
  const mine = flow.open.filter((c) => c.waitingOn.role === "cs" && (!name || c.waitingOn.name.trim().toLowerCase() === name));
  const noCs = flow.open.filter((c) => c.waitingOn.role === "cs_manager");
  const withBroker = flow.open.filter((c) => c.waitingOn.role === "broker_admin" && (!name || c.cs.trim().toLowerCase() === name));
  const byCs = new Map<string, { name: string; onboard: number; mt5: number; broker: number }>();
  for (const c of [...mine, ...withBroker]) {
    const n = c.waitingOn.role === "cs" ? c.waitingOn.name : c.cs;
    const k = n.trim().toLowerCase();
    const x = byCs.get(k) ?? { name: n || "—", onboard: 0, mt5: 0, broker: 0 };
    if (c.waitingOn.role === "broker_admin") x.broker++;
    else if (c.stage === "onboarded") x.onboard++;
    else x.mt5++;
    byCs.set(k, x);
  }
  const rows = Array.from(byCs.values()).sort((a, b) => b.onboard + b.mt5 - (a.onboard + a.mt5) || a.name.localeCompare(b.name));
  const list = [...mine, ...withBroker].sort((a, b) => (a.since || a.closedAt).localeCompare(b.since || b.closedAt));
  return (
    <div className="space-y-3">
      {!only && (
        <p className="text-sm text-muted-foreground">
          {noCs.length ? <><span className="font-semibold text-foreground">{noCs.length}</span> enrolment{noCs.length === 1 ? "" : "s"} in Tetra Commission with no CS given yet (CS managers). </> : null}
          The sales CRMs&apos; closes waiting on a CSE — and on a broker admin for their students&apos; MT5 bonus.
        </p>
      )}
      {list.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No enrolment is waiting on {only ? "them" : "a CSE"}.</p> : (
        <div className="max-h-[420px] overflow-auto">
          {!only ? (
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">CSE</th>
                  <th className="pb-2 pr-3 text-right font-medium">Welcome to send</th>
                  <th className="pb-2 pr-3 text-right font-medium">MT5 to log / bonus turned down</th>
                  <th className="pb-2 text-right font-medium">Bonus with a broker admin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-b border-border/20 last:border-0">
                    <td className="py-2 pr-3 font-medium">{r.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.onboard || <span className="text-muted-foreground/60">—</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.mt5 || <span className="text-muted-foreground/60">—</span>}</td>
                    <td className="py-2 text-right tabular-nums">{r.broker || <span className="text-muted-foreground/60">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[620px] text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Student</th>
                  <th className="pb-2 pr-3 font-medium">Closed in</th>
                  <th className="pb-2 pr-3 font-medium">Stands at</th>
                  <th className="pb-2 text-right font-medium">Since</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={`${c.portal}:${c.id}`} className="border-b border-border/20 align-top last:border-0">
                    <td className="py-2 pr-3"><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{[c.course, c.invoiceNumber].filter(Boolean).join(" · ")}</div></td>
                    <td className="py-2 pr-3">{c.portalName}<div className="text-xs text-muted-foreground">by {c.closedBy.name || "—"}</div></td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className="py-0 text-[11px]">{STEP_LABEL[c.stage]}</Badge>
                      <div className="mt-0.5 max-w-[300px] text-xs text-muted-foreground">{c.waitingOn.role === "broker_admin" ? "With a broker admin" : c.detail}</div>
                    </td>
                    <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums text-muted-foreground">{daysSince(c.since || c.closedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
