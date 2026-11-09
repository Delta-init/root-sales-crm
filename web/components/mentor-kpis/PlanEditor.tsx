"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CATEGORY_COLOURS, TARGET_RANGE, addMonths, dubaiMonth, monthLabel, pct1, planShares,
  type KpiMetric, type KpiMode, type KpiPlan, type KpiRole, type MentorTarget, type PlanCategory, type RoleTargets,
} from "./types";

/*
 * The plan, as root admins edit it (the user, 2026-11-09): categories → subcategories → KPIs. Every weight and target
 * has a slider and a box to type in, kept in step; the bars show how each level splits — categories adding to 100%,
 * a subcategory's part of its category, a KPI's part of its subcategory — with each one's share of the whole score.
 * Only category weights must total 100; the others are relative and Root turns them into shares. A KPI is always a
 * metric Root can measure (or will, once its system sends it); targets are per role, and a mentor can have their own.
 * Read only when showing the plan in force.
 */

export interface DraftBody { from: string; categories: PlanCategory[]; targets: RoleTargets; overrides: MentorTarget[]; note: string }

const slug = (name: string, taken: string[]) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "item";
  let key = base, i = 2;
  while (taken.includes(key)) key = `${base}_${i++}`;
  return key;
};
const clampInt = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : 0)));

/** A slider and a typed box for one number, in step. */
function Pair({ value, onChange, min, max, step, label, readOnly, suffix, width = "w-20", typedMax }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step: number; label: string; readOnly?: boolean;
  suffix?: string; width?: string; typedMax?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  if (readOnly) return <span className="tabular-nums text-sm">{value}{suffix ? ` ${suffix}` : ""}</span>;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <input
        type="range" min={min} max={max} step={step} value={Math.min(value, max)} aria-label={`${label} slider`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 min-w-[60px] flex-1 cursor-pointer accent-primary"
      />
      <Input
        type="number" min={min} max={typedMax} step={step} value={text} aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(v)) onChange(typedMax == null ? Math.max(min, v) : Math.max(min, Math.min(typedMax, v)));
        }}
        onBlur={() => setText(String(value))}
        className={cn("h-8 text-right tabular-nums", width)}
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function Bar({ fraction, colour }: { fraction: number; colour: string }) {
  return (
    <div className="h-2 min-w-[40px] flex-1 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: colour }} />
    </div>
  );
}

function Rename({ name, onRename, readOnly }: { name: string; onRename: (n: string) => void; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  if (readOnly || !editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-medium">{name}</span>
        {!readOnly && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setText(name); setEditing(true); }} aria-label={`Rename ${name}`} className="text-muted-foreground hover:text-foreground">
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }
  const done = () => { const t = text.trim().slice(0, 60); if (t) onRename(t); setEditing(false); };
  return (
    <Input
      autoFocus value={text} onClick={(e) => e.stopPropagation()} onChange={(e) => setText(e.target.value)}
      onBlur={done} onKeyDown={(e) => { if (e.key === "Enter") done(); if (e.key === "Escape") setEditing(false); }}
      className="h-7 w-48"
    />
  );
}

export function PlanEditor({ plan, metrics, roles, readOnly, onChange, basisMonths }: {
  plan: DraftBody;
  metrics: KpiMetric[];
  roles: { key: KpiRole; label: string }[];
  readOnly?: boolean;
  onChange?: (next: DraftBody) => void;
  basisMonths?: KpiPlan["targetsBasis"];
}) {
  const [role, setRole] = useState<KpiRole>("junior_mentor");
  const [open, setOpen] = useState<Record<string, boolean>>({ [plan.categories[0]?.key ?? ""]: true });
  const byKey = useMemo(() => new Map(metrics.map((m) => [m.key, m])), [metrics]);
  const shares = planShares(plan.categories);
  const total = plan.categories.reduce((a, c) => a + c.weight, 0);
  const scale = Math.max(100, total);
  const edit = (fn: (d: DraftBody) => void) => {
    if (readOnly || !onChange) return;
    const next = structuredClone(plan);
    fn(next);
    onChange(next);
  };
  const used = new Set(plan.categories.flatMap((c) => c.subs.flatMap((s) => s.kpis.map((k) => k.metric))));
  const roleLabel = roles.find((r) => r.key === role)?.label ?? role;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Targets for</span>
        <select value={role} onChange={(e) => setRole(e.target.value as KpiRole)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Targets for role">
          {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {basisMonths && (
          <span className="text-xs text-muted-foreground">Suggested from {basisMonths.months.map((m) => monthLabel(m).split(" ")[0]).join(", ")} — the median mentor-month</span>
        )}
      </div>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Category weights</span>
            <Badge variant={total === 100 ? "success" : "destructive"}>{total}% of 100%</Badge>
          </div>
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded bg-muted">
            {plan.categories.map((c, i) => c.weight > 0 && (
              <div key={c.key} title={`${c.name} ${c.weight}%`} style={{ width: `${(c.weight / scale) * 100}%`, background: CATEGORY_COLOURS[i % CATEGORY_COLOURS.length] }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {plan.categories.map((c, i) => (
              <span key={c.key} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOURS[i % CATEGORY_COLOURS.length] }} />{c.name} {c.weight}%
              </span>
            ))}
            {total < 100 && <span className="text-red-500">Unassigned {100 - total}%</span>}
            {total > 100 && <span className="text-red-500">Over by {total - 100}%</span>}
          </div>
        </CardContent>
      </Card>

      {plan.categories.map((c, ci) => {
        const colour = CATEGORY_COLOURS[ci % CATEGORY_COLOURS.length];
        const isOpen = open[c.key] ?? false;
        const nk = c.subs.reduce((a, s) => a + s.kpis.length, 0);
        return (
          <Card key={c.key}>
            <div
              className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
              onClick={() => setOpen((o) => ({ ...o, [c.key]: !isOpen }))}
            >
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span className="h-3 w-3 rounded-sm" style={{ background: colour }} />
              <span className="min-w-[160px] flex-1">
                <Rename name={c.name} readOnly={readOnly} onRename={(n) => edit((d) => { d.categories[ci].name = n; })} />
                <span className="ml-1 text-xs text-muted-foreground">· {c.subs.length} sub · {nk} KPIs</span>
              </span>
              <div className="flex w-full items-center gap-2 sm:w-72" onClick={(e) => e.stopPropagation()}>
                <Pair value={c.weight} min={0} max={100} step={1} typedMax={100} suffix="%" label={`${c.name} weight`} readOnly={readOnly}
                  onChange={(v) => edit((d) => { d.categories[ci].weight = clampInt(v); })} />
              </div>
              {!readOnly && (
                <button type="button" aria-label={`Remove ${c.name}`} className="text-muted-foreground hover:text-red-500"
                  onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${c.name} and everything in it from this draft?`)) edit((d) => { d.categories.splice(ci, 1); }); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            {isOpen && (
              <div className="border-t">
                {c.subs.length === 0 && <p className="px-6 py-3 text-sm text-muted-foreground">No subcategories yet. Add one below.</p>}
                {c.subs.map((s, si) => {
                  const ss = shares[ci].subs[si];
                  return (
                    <div key={s.key} className="space-y-2 border-b px-4 py-3 pl-8 last:border-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        <span className="min-w-[140px] flex-1"><Rename name={s.name} readOnly={readOnly} onRename={(n) => edit((d) => { d.categories[ci].subs[si].name = n; })} /></span>
                        <span className="text-xs tabular-nums text-muted-foreground">{pct1(ss.share)} of the score</span>
                        {!readOnly && (
                          <button type="button" aria-label={`Remove ${s.name}`} className="text-muted-foreground hover:text-red-500"
                            onClick={() => { if (confirm(`Remove ${s.name} and its KPIs from this draft?`)) edit((d) => { d.categories[ci].subs.splice(si, 1); }); }}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <div className="flex min-w-[220px] flex-1 items-center gap-2">
                          <span className="text-xs text-muted-foreground">Relative weight</span>
                          <Pair value={s.weight} min={0} max={100} step={1} typedMax={100} label={`${s.name} weight`} readOnly={readOnly}
                            onChange={(v) => edit((d) => { d.categories[ci].subs[si].weight = clampInt(v); })} />
                        </div>
                        <div className="flex min-w-[180px] flex-1 items-center gap-2">
                          <Bar fraction={ss.ofCategory} colour={colour} />
                          <span className="whitespace-nowrap text-xs text-muted-foreground">{Math.round(ss.ofCategory * 100)}% of {c.name}</span>
                        </div>
                      </div>

                      {s.kpis.length === 0 && <p className="pl-2 text-sm text-muted-foreground">No KPIs yet.</p>}
                      {s.kpis.map((k, ki) => {
                        const m = byKey.get(k.metric);
                        const ks = ss.kpis[ki];
                        const target = plan.targets[role]?.[k.metric];
                        const [lo, hi, st] = TARGET_RANGE[m?.unit ?? "%"] ?? [0, 100, 1];
                        const basis = basisMonths?.counts?.[role]?.[k.metric];
                        return (
                          <div key={k.metric} className="ml-2 space-y-2 rounded-lg border border-dashed px-3 py-2">
                            <div className="flex flex-wrap items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm">{m?.name ?? k.metric}</p>
                                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                  {m?.sourceLabel} ·
                                  {m?.direction === "down" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                                  {m?.direction === "down" ? "fewer is better" : "more is better"}
                                  {m && !m.available && <Badge variant="warning" className="ml-1 px-1.5 text-[10px]" title={m.note}>Not available yet</Badge>}
                                </div>
                                {m && !m.available && m.note && <p className="text-[11px] text-muted-foreground">{m.note}</p>}
                              </div>
                              {readOnly ? (
                                <Badge variant="secondary">{k.mode === "scored" ? "Scored" : k.mode === "monitoring" ? "Monitoring" : "Off"}</Badge>
                              ) : (
                                <>
                                  <select value={k.mode} aria-label={`${m?.name} counts as`}
                                    onChange={(e) => edit((d) => { d.categories[ci].subs[si].kpis[ki].mode = e.target.value as KpiMode; })}
                                    className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                                    <option value="scored">Scored</option>
                                    <option value="monitoring">Monitoring</option>
                                    <option value="off">Off</option>
                                  </select>
                                  <button type="button" aria-label={`Remove ${m?.name}`} className="pt-1.5 text-muted-foreground hover:text-red-500"
                                    onClick={() => edit((d) => { d.categories[ci].subs[si].kpis.splice(ki, 1); })}>
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            </div>
                            {k.mode === "off" ? (
                              <p className="text-xs text-muted-foreground">Off: not scored or shown.</p>
                            ) : (
                              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                <div className="flex min-w-[240px] flex-[1.3] items-center gap-2">
                                  <span className="text-xs text-muted-foreground">Target</span>
                                  {readOnly ? (
                                    <span className="text-sm tabular-nums">{target == null ? "—" : `${target} ${m?.unit ?? ""}`}</span>
                                  ) : (
                                    <Pair value={target ?? 0} min={lo} max={hi} step={st} label={`${m?.name} target for ${roleLabel}`} suffix={m?.unit} width="w-24"
                                      onChange={(v) => edit((d) => { d.targets[role] = { ...d.targets[role], [k.metric]: v }; })} />
                                  )}
                                </div>
                                {k.mode === "scored" ? (
                                  <>
                                    <div className="flex min-w-[190px] flex-1 items-center gap-2">
                                      <span className="text-xs text-muted-foreground">Weight</span>
                                      <Pair value={k.weight} min={0} max={100} step={1} typedMax={100} label={`${m?.name} weight`} readOnly={readOnly}
                                        onChange={(v) => edit((d) => { d.categories[ci].subs[si].kpis[ki].weight = clampInt(v); })} />
                                    </div>
                                    <div className="flex min-w-[150px] flex-1 items-center gap-2">
                                      <Bar fraction={ks.ofSub} colour={colour} />
                                      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{pct1(ks.share)} of score</span>
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Monitoring: shown, not scored</span>
                                )}
                              </div>
                            )}
                            {target == null && k.mode === "scored" && m?.available && (
                              <p className="text-xs text-amber-600 dark:text-amber-400">No {roleLabel.toLowerCase()} target yet.</p>
                            )}
                            {basis != null && <p className="text-[11px] text-muted-foreground">Suggested from {basis} mentor-months.</p>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}

      {!readOnly && <AddPanel plan={plan} metrics={metrics} used={used} edit={edit} roleLabel={roleLabel} open={(k) => setOpen((o) => ({ ...o, [k]: true }))} />}
      <Overrides plan={plan} metrics={metrics} byKey={byKey} readOnly={readOnly} edit={edit} />
    </div>
  );
}

/* ── Adding a category, a subcategory or a KPI ─────────────────────────────────────────────────────────────────── */

function AddPanel({ plan, metrics, used, edit, open }: {
  plan: DraftBody; metrics: KpiMetric[]; used: Set<string>; edit: (fn: (d: DraftBody) => void) => void; roleLabel: string; open: (key: string) => void;
}) {
  const [type, setType] = useState<"kpi" | "sub" | "cat">("kpi");
  const [cat, setCat] = useState(0);
  const [sub, setSub] = useState(0);
  const [metric, setMetric] = useState("");
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");
  const c = plan.categories[cat] ?? plan.categories[0];
  const free = metrics.filter((m) => !used.has(m.key));
  const m = metrics.find((x) => x.key === metric);
  const clear = () => { setName(""); setWeight(""); setTarget(""); setMetric(""); setErr(""); };

  const add = () => {
    const w = Number(weight);
    if (weight !== "" && (!Number.isInteger(w) || w < 0 || w > 100)) return setErr("Weight is a whole number from 0 to 100.");
    if (type === "cat") {
      const n = name.trim();
      if (!n) return setErr("Enter a category name first.");
      if (plan.categories.some((x) => x.name.toLowerCase() === n.toLowerCase())) return setErr("That category already exists.");
      if (plan.categories.length >= 12) return setErr("At most 12 categories.");
      const key = slug(n, plan.categories.map((x) => x.key));
      edit((d) => { d.categories.push({ key, name: n, weight: weight === "" ? 0 : w, subs: [] }); });
      open(key);
    } else if (type === "sub") {
      const n = name.trim();
      if (!c) return setErr("Add a category first.");
      if (!n) return setErr("Enter a subcategory name first.");
      if (c.subs.some((x) => x.name.toLowerCase() === n.toLowerCase())) return setErr(`That subcategory already exists in ${c.name}.`);
      if (!(w > 0)) return setErr("Enter a relative weight above 0.");
      const key = slug(n, c.subs.map((x) => x.key));
      edit((d) => { d.categories[cat].subs.push({ key, name: n, weight: w, kpis: [] }); });
      open(c.key);
    } else {
      const s = c?.subs[sub];
      if (!s) return setErr(`Add a subcategory to ${c?.name ?? "the category"} first.`);
      if (!m) return setErr("Pick a metric first.");
      if (!(w > 0)) return setErr("Enter a weight above 0.");
      const t = Number(target);
      if (target !== "" && (!Number.isFinite(t) || t < 0)) return setErr("The target is a number of 0 or more.");
      edit((d) => {
        d.categories[cat].subs[sub].kpis.push({ metric: m.key, weight: w, mode: "scored" });
        if (target !== "") for (const r of Object.keys(d.targets) as KpiRole[]) d.targets[r] = { ...d.targets[r], [m.key]: t };
      });
      open(c.key);
    }
    clear();
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Add to the plan</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select value={type} onChange={(e) => { setType(e.target.value as typeof type); setErr(""); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="What to add">
            <option value="kpi">KPI</option>
            <option value="sub">Subcategory</option>
            <option value="cat">Category</option>
          </select>
          {type !== "cat" && (
            <select value={cat} onChange={(e) => { setCat(Number(e.target.value)); setSub(0); setErr(""); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Category">
              {plan.categories.map((x, i) => <option key={x.key} value={i}>{x.name}</option>)}
            </select>
          )}
          {type === "kpi" && (
            <select value={sub} onChange={(e) => { setSub(Number(e.target.value)); setErr(""); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Subcategory">
              {c?.subs.length ? c.subs.map((x, i) => <option key={x.key} value={i}>{x.name}</option>) : <option value={0}>No subcategory yet</option>}
            </select>
          )}
          {type === "kpi" && (
            <select value={metric} onChange={(e) => { setMetric(e.target.value); setErr(""); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Metric">
              <option value="">Pick a metric</option>
              {free.map((x) => <option key={x.key} value={x.key}>{x.name}{x.available ? "" : " (not available yet)"}</option>)}
            </select>
          )}
          {type !== "kpi" && <Input value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder={type === "cat" ? "Category name" : "Subcategory name"} />}
          {type === "kpi" && <Input type="number" min={0} value={target} onChange={(e) => { setTarget(e.target.value); setErr(""); }} placeholder="Starting target (all roles)" />}
          <Input type="number" min={0} max={100} value={weight} onChange={(e) => { setWeight(e.target.value); setErr(""); }} placeholder={type === "cat" ? "Weight %" : "Relative weight"} />
        </div>
        <p className="text-xs text-muted-foreground">
          {type === "kpi"
            ? m ? `${m.sourceLabel} · ${m.unit} · ${m.direction === "up" ? "more" : "fewer"} is better. ${m.note}` : "Only metrics Root can measure — or will, once their system sends them — can be KPIs. A new kind of metric needs its data feed built first."
            : type === "cat" ? "A new category starts empty. Category weights must total 100% before approval." : "Its weight is relative to the other subcategories in the same category."}
        </p>
        {err && <p className="text-sm text-red-500">{err}</p>}
        <Button size="sm" variant="outline" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
      </CardContent>
    </Card>
  );
}

/* ── A mentor's own targets ────────────────────────────────────────────────────────────────────────────────────── */

function Overrides({ plan, metrics, byKey, readOnly, edit }: {
  plan: DraftBody; metrics: KpiMetric[]; byKey: Map<string, KpiMetric>; readOnly?: boolean; edit: (fn: (d: DraftBody) => void) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const inPlan = metrics.filter((m) => plan.categories.some((c) => c.subs.some((s) => s.kpis.some((k) => k.metric === m.key))));
  if (readOnly && !plan.overrides.length) return null;

  const add = () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setErr("Enter the mentor's email address.");
    if (!metric) return setErr("Pick the KPI.");
    const v = Number(value);
    if (value === "" || !Number.isFinite(v) || v < 0) return setErr("The target is a number of 0 or more.");
    if (!reason.trim()) return setErr("Say why they have their own target.");
    if (plan.overrides.some((o) => o.email === e && o.metric === metric)) return setErr("They already have their own target for that KPI.");
    edit((d) => { d.overrides.push({ email: e, name: name.trim(), metric, value: v, reason: reason.trim() }); });
    setEmail(""); setName(""); setMetric(""); setValue(""); setReason(""); setErr("");
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">A mentor&apos;s own targets</CardTitle>
        <p className="text-sm text-muted-foreground">For workload, a part-time month or a different course mix. It replaces their role&apos;s target for that KPI.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan.overrides.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Mentor</th><th className="py-1 font-medium">KPI</th><th className="py-1 font-medium">Target</th><th className="py-1 font-medium">Why</th><th /></tr></thead>
              <tbody>
                {plan.overrides.map((o, i) => (
                  <tr key={`${o.email}|${o.metric}`} className="border-t">
                    <td className="py-1.5">{o.name || o.email}<p className="text-xs text-muted-foreground">{o.email}</p></td>
                    <td className="py-1.5">{byKey.get(o.metric)?.name ?? o.metric}</td>
                    <td className="py-1.5 tabular-nums">{o.value} {byKey.get(o.metric)?.unit}</td>
                    <td className="py-1.5 text-muted-foreground">{o.reason}</td>
                    <td className="py-1.5 text-right">
                      {!readOnly && (
                        <button type="button" aria-label="Remove this target" className="text-muted-foreground hover:text-red-500" onClick={() => edit((d) => { d.overrides.splice(i, 1); })}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!readOnly && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Input value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} placeholder="mentor@deltainstitutions.com" aria-label="Mentor's email" />
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Mentor's name" />
              <select value={metric} onChange={(e) => { setMetric(e.target.value); setErr(""); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="KPI">
                <option value="">Pick the KPI</option>
                {inPlan.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
              </select>
              <Input type="number" min={0} value={value} onChange={(e) => { setValue(e.target.value); setErr(""); }} placeholder="Their target" aria-label="Their target" />
              <Input value={reason} onChange={(e) => { setReason(e.target.value); setErr(""); }} placeholder="Why" aria-label="Why" />
            </div>
            {err && <p className="text-sm text-red-500">{err}</p>}
            <Button size="sm" variant="outline" onClick={add}><Plus className="mr-1 h-4 w-4" />Add their target</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The months a draft can start in: this one and the next five. */
export const draftMonths = () => Array.from({ length: 6 }, (_, i) => addMonths(dubaiMonth(), i));
