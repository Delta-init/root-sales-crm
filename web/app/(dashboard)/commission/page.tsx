"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Coins, Database, Lock, Pencil, Plus, Trash2, Undo2, Users } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, apiErrorMessage } from "@/lib/axios";
import type { CommissionCompare, CommissionSlabRow, CommissionTeamPlan, CrmCommissionPlan, RootCommissionPlan } from "@/lib/types";

/**
 * Commission plans. Each sales CRM's own plan, read only (the user, 2026-10-09), and — since 2026-11-01 ("one plan,
 * in Root, edited by portal, position and course") — the plan kept in Root, which root admins edit here: a course's
 * row, a position's slabs, the Sales Manager and who earns nothing. The CRMs keep counting with their own plan until
 * they are switched to ask Root, so where the two differ is shown. Root admins only.
 */

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
/** The portal's server from before this page: it has no /commission-plans yet. */
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;
const aed = (n: number) => (n ? `AED ${n.toLocaleString("en-US")}` : "—");
const money = (n: number) => n.toLocaleString("en-US");
/**
 * A course's rupee amounts (the user, 2026-11-13: "separate INR commission for each course, same plan but the INR pay
 * will be different"): what the part of a sale paid in rupees pays each position — typed on their own, never the AED
 * ones converted. None set: that part is paid at the AED amount.
 */
type InrAmounts = { salesInr?: number; tlInr?: number; smInr?: number };
const hasInr = (r: InrAmounts | null | undefined, tlPaid: boolean) => (r?.salesInr ?? 0) + (tlPaid ? r?.tlInr ?? 0 : 0) + (r?.smInr ?? 0) > 0;
/** The rupee amount under its AED one. */
function Inr({ n }: { n: number | undefined }) {
  return n ? <span className="block text-[11px] font-normal text-amber-600 dark:text-amber-400">INR {n.toLocaleString("en-US")}</span> : null;
}
const SLAB_ROLES = [
  { key: "sales", label: "Sales Staff" },
  { key: "tl", label: "Team Leader" },
  { key: "sm", label: "Sales Manager" },
] as const;
const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));

/** The CRM tab last looked at. */
const TAB_STORE = "root.commission.crm";

export default function CommissionPlansPage() {
  const plans = useQuery({
    queryKey: ["commission-plans"],
    queryFn: async () => (await api.get("/commission-plans")).data.data as CrmCommissionPlan[],
  });
  const [tab, setTab] = useState("");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_STORE);
      if (saved) setTab(saved);
    } catch {
      /* private window or blocked storage: the first CRM */
    }
  }, []);
  const choose = (code: string) => {
    setTab(code);
    try {
      window.localStorage.setItem(TAB_STORE, code);
    } catch {
      /* nothing to remember it in */
    }
  };

  if (forbidden(plans.error)) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">Commission plans are for root admins.</CardContent>
      </Card>
    );
  }

  const list = plans.data ?? [];
  const plan = list.find((p) => p.code === tab) ?? list[0];
  const tlPaid = plan?.tlRule !== "never";
  const root = plan?.root ?? null;

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Coins className="h-6 w-6 text-primary" /> Commission plans
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
            <Database className="h-3.5 w-3.5" /> One plan per sales CRM, kept in Root and edited here. The CRMs&apos; own plans stay read only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist">
          {list.map((p) => (
            <Button key={p.code} size="sm" role="tab" aria-selected={p.code === plan?.code}
              variant={p.code === plan?.code ? "default" : "outline"} onClick={() => choose(p.code)}>
              {p.name}
            </Button>
          ))}
          {plans.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-28" />)}
        </div>
      </motion.div>

      {notYet(plans.error) && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            The portal&apos;s server is still on the previous version, so this page has nothing to show yet. It works once the server is updated.
          </CardContent>
        </Card>
      )}

      {plan && !plan.available && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">{plan.name} could not be read</p>
              <p className="mt-1 text-muted-foreground">{plan.error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {plan && root && <RootPlanSection code={plan.code} name={plan.name} tlPaid={tlPaid} crm={plan} root={root} />}

      {plan && !root && plan.available && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p>
              {plan.name}&apos;s plan hasn&apos;t been copied into Root yet, so it can&apos;t be edited here. Below is the CRM&apos;s own plan, read only.
            </p>
          </CardContent>
        </Card>
      )}

      {plan?.available && !root && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Sales Manager</p>
                <p className="mt-1 text-lg font-semibold">{plan.salesManager ?? "Not set"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Team leaders</p>
                <p className="mt-1 text-sm">{plan.tlRuleLabel}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Earn nothing</p>
                <p className="mt-1 text-sm">{plan.excluded.length ? plan.excluded.join(", ") : "No one"}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                <span>Per course, for each sale</span>
                <span className="shrink-0 text-sm font-normal text-muted-foreground">{plan.courses.length} courses</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {plan.courses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No courses.</p>
              ) : (
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Course</th>
                      <th className="pb-2 pr-3 font-medium">Fee</th>
                      <th className="pb-2 pr-3 text-right font-medium">Sales Staff</th>
                      {tlPaid && <th className="pb-2 pr-3 text-right font-medium">Team Leader</th>}
                      <th className="pb-2 pr-3 text-right font-medium">Sales Manager</th>
                      <th className="pb-2 text-right font-medium">MT5 credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.courses.map((c) => (
                      <tr key={c.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5 pr-3">
                          <span className="font-medium">{c.name}</span>
                          {c.status && c.status !== "active" && (
                            <Badge variant="secondary" className="ml-2 capitalize">{c.status}</Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-muted-foreground">{aed(c.fee)}</td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-right">{aed(c.sales)}</td>
                        {tlPaid && <td className="whitespace-nowrap py-2.5 pr-3 text-right">{aed(c.tl)}</td>}
                        <td className="whitespace-nowrap py-2.5 pr-3 text-right">{aed(c.sm)}</td>
                        <td className="whitespace-nowrap py-2.5 text-right">{c.creditUsd ? `$${money(c.creditUsd)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                <span>Salary slabs</span>
                <span className="shrink-0 text-sm font-normal text-muted-foreground">
                  {plan.slabs ? `In force since ${monthLabel(plan.slabs.from)}` : "The CRM's built-in slabs"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {plan.slabs ? (
                <div className="grid gap-6 lg:grid-cols-3">
                  {SLAB_ROLES.filter((r) => plan.slabs![r.key].length).map((r) => (
                    <SlabTable key={r.key} label={r.label} rows={plan.slabs![r.key]} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No slabs saved in this CRM, so it pays from the slabs built into its code.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {plans.isLoading && <Skeleton className="h-64 w-full" />}
    </div>
  );
}

function SlabTable({ label, rows, onEdit }: { label: string; rows: CommissionSlabRow[]; onEdit?: () => void }) {
  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {onEdit && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onEdit} aria-label={`Edit the ${label} slab`}><Pencil className="h-3.5 w-3.5" /></Button>}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-3 font-medium">Slab</th>
            <th className="pb-2 pr-3 text-right font-medium">From (AED)</th>
            <th className="pb-2 pr-3 text-right font-medium">Salary</th>
            <th className="pb-2 text-right font-medium">Commission</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.name + s.target} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-3 font-medium">{s.name}</td>
              <td className="py-2 pr-3 text-right">{money(s.target)}</td>
              <td className="py-2 pr-3 text-right">{money(s.salary)}</td>
              <td className="py-2 text-right">{s.percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Root's plan, edited here (2026-11-01) ──────────────────────────────────────────────────────────────────────── */

type Plans = CrmCommissionPlan[];
const SELECT = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso)) : "";

/** A save: PUT (or DELETE, putting a team back on the portal's plan), then the plans as they now stand. */
function useSave(code: string, done: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, body, remove }: { path: string; body?: unknown; remove?: boolean }) =>
      (remove ? await api.delete(`/commission-plans/${code}/${path}`) : await api.put(`/commission-plans/${code}/${path}`, body)).data.data as Plans,
    onSuccess: (data) => {
      qc.setQueryData(["commission-plans"], data);
      toast.success("Commission plan saved");
      done();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save the plan")),
  });
}

/** What the CRM itself has, under Root's figure, when the two differ — until the CRM counts with Root's. */
function Differs({ crm, root, fmt }: { crm: number | undefined; root: number; fmt: (n: number) => string }) {
  if (crm === undefined || crm === root) return null;
  return <span className="block text-[11px] text-amber-600 dark:text-amber-400">CRM: {fmt(crm)}</span>;
}

function RootPlanSection({ code, name, tlPaid, crm, root }: { code: string; name: string; tlPaid: boolean; crm: CrmCommissionPlan; root: RootCommissionPlan }) {
  const [course, setCourse] = useState<RootCommissionPlan["courses"][number] | null>(null);
  const [slab, setSlab] = useState<(typeof SLAB_ROLES)[number] | null>(null);
  const [people, setPeople] = useState(false);
  const [applying, setApplying] = useState(false);
  // Months these slabs can be put in force from instead: October 2026 (when pay on the slabs began) up to the month
  // before they start, never this month or later (2026-11-01).
  const thisMonth = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 7);
  const earlier = payMonths().filter((m) => m < root.slabs.from && m < thisMonth);
  const crmCourse = new Map(crm.courses.map((c) => [c.id, c]));
  const roles = SLAB_ROLES.filter((r) => r.key !== "tl" || root.tlSlab);
  return (
    <>
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-6 text-sm">
          <p>
            <span className="font-medium">{name}&apos;s plan, kept in Root.</span> Changes here are saved in Root. {name} still counts commission with its
            own plan until it is switched to Root&apos;s — where the two differ, the CRM&apos;s figure is shown in amber.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Copied from the CRM {when(root.copiedAt)}{root.updatedByEmail && root.updatedAt ? ` · last changed ${when(root.updatedAt)} by ${root.updatedByEmail}` : ""}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Sales Manager</p>
              <Button size="sm" variant="ghost" className="-mt-1.5 h-7 px-2" onClick={() => setPeople(true)}><Pencil className="h-3.5 w-3.5" /></Button>
            </div>
            <p className="mt-1 text-lg font-semibold">{root.salesManager?.name ?? "Not set"}</p>
            {crm.available && (crm.salesManager ?? null) !== (root.salesManager?.name ?? null) && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">CRM: {crm.salesManager ?? "Not set"}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Team leaders</p>
            <p className="mt-1 text-sm">{crm.tlRuleLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Earn nothing</p>
              <Button size="sm" variant="ghost" className="-mt-1.5 h-7 px-2" onClick={() => setPeople(true)}><Pencil className="h-3.5 w-3.5" /></Button>
            </div>
            <p className="mt-1 text-sm">{root.excluded.length ? root.excluded.map((p) => p.name).join(", ") : "No one"}</p>
            {crm.available && crm.excluded.join(", ") !== root.excluded.map((p) => p.name).join(", ") && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">CRM: {crm.excluded.length ? crm.excluded.join(", ") : "No one"}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-baseline justify-between gap-2 text-base">
            <span>Per course, for each sale</span>
            <span className="shrink-0 text-sm font-normal text-muted-foreground">{root.courses.length} courses · a change counts for sales from then on</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Course</th>
                <th className="pb-2 pr-3 font-medium">Fee</th>
                <th className="pb-2 pr-3 text-right font-medium">Sales Staff</th>
                {tlPaid && <th className="pb-2 pr-3 text-right font-medium">Team Leader</th>}
                <th className="pb-2 pr-3 text-right font-medium">Sales Manager</th>
                <th className="pb-2 pr-3 text-right font-medium">MT5 credit</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {root.courses.map((c) => {
                const theirs = crmCourse.get(c.id);
                return (
                  <tr key={c.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium">{c.name}</span>
                      {c.status && c.status !== "active" && <Badge variant="secondary" className="ml-2 capitalize">{c.status}</Badge>}
                      {!c.set && <Badge variant="outline" className="ml-2">Not set</Badge>}
                      {!c.inCrm && <Badge variant="outline" className="ml-2">Not in the CRM</Badge>}
                      {c.updatedAt && c.updatedByEmail && !c.updatedByEmail.startsWith("copied") && (
                        <span className="block text-[11px] text-muted-foreground">changed {when(c.updatedAt)} by {c.updatedByEmail}</span>
                      )}
                      {c.set && !hasInr(c, tlPaid) && <span className="block text-[11px] text-muted-foreground">No INR amounts yet — a rupee payment pays the AED ones</span>}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-muted-foreground">{aed(c.fee)}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right">{aed(c.sales)}<Differs crm={theirs?.sales} root={c.sales} fmt={aed} /><Inr n={c.salesInr} /></td>
                    {tlPaid && <td className="whitespace-nowrap py-2.5 pr-3 text-right">{aed(c.tl)}<Differs crm={theirs?.tl} root={c.tl} fmt={aed} /><Inr n={c.tlInr} /></td>}
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right">{aed(c.sm)}<Differs crm={theirs?.sm} root={c.sm} fmt={aed} /><Inr n={c.smInr} /></td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right">
                      {c.creditUsd ? `$${money(c.creditUsd)}` : "—"}<Differs crm={theirs?.creditUsd} root={c.creditUsd} fmt={(n) => (n ? `$${money(n)}` : "—")} />
                    </td>
                    <td className="py-2.5 text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setCourse(c)} aria-label={`Edit ${c.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-baseline justify-between gap-2 text-base">
            <span>Salary slabs</span>
            <span className="flex shrink-0 items-center gap-3 text-sm font-normal text-muted-foreground">
              In force since {root.slabs.from === "2000-01" ? "the start (the CRM's built-in slabs)" : monthLabel(root.slabs.from)} · a change starts this month
              {earlier.length > 0 && (
                <Button size="sm" variant="outline" className="h-7" onClick={() => setApplying(true)}>
                  <CalendarClock className="mr-1 h-3.5 w-3.5" /> Apply to an earlier month
                </Button>
              )}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-3">
            {roles.map((r) => (
              <div key={r.key}>
                <SlabTable label={r.label} rows={root.slabs[r.key]} onEdit={() => setSlab(r)} />
                {crm.available && crm.slabs && JSON.stringify(crm.slabs[r.key]) !== JSON.stringify(root.slabs[r.key]) && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">The CRM&apos;s own {r.label} slab differs.</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {!!root.teams?.length && <TeamPlansCard code={code} tlPaid={tlPaid} root={root} />}

      <CompareCard code={code} name={name} />

      {root.changes.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Changes made here</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {root.changes.map((c, i) => (
                <li key={i} className="border-b border-border/50 pb-2 last:border-0">
                  <p>{c.detail}</p>
                  <p className="text-xs text-muted-foreground">{when(c.at)} · {c.by}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {course && <CourseDialog code={code} tlPaid={tlPaid} course={course} onClose={() => setCourse(null)} />}
      {slab && <SlabDialog code={code} role={slab} rows={root.slabs[slab.key]} onClose={() => setSlab(null)} />}
      {people && <PeopleDialog code={code} root={root} onClose={() => setPeople(false)} />}
      {applying && <ApplyFromDialog code={code} name={name} from={root.slabs.from} months={earlier} onClose={() => setApplying(false)} />}
    </>
  );
}

function CourseDialog({ code, tlPaid, course, onClose }: { code: string; tlPaid: boolean; course: RootCommissionPlan["courses"][number]; onClose: () => void }) {
  const [form, setForm] = useState({
    sales: String(course.sales), tl: String(course.tl), sm: String(course.sm), creditUsd: String(course.creditUsd),
    salesInr: String(course.salesInr ?? 0), tlInr: String(course.tlInr ?? 0), smInr: String(course.smInr ?? 0),
  });
  const save = useSave(code, onClose);
  const fields: Array<{ key: keyof typeof form; label: string }> = [
    { key: "sales", label: "Sales Staff (AED)" },
    ...(tlPaid ? [{ key: "tl" as const, label: "Team Leader (AED)" }] : []),
    { key: "sm", label: "Sales Manager (AED)" },
    { key: "creditUsd", label: "MT5 credit (USD)" },
  ];
  const inrFields: Array<{ key: keyof typeof form; label: string }> = [
    { key: "salesInr", label: "Sales Staff (INR)" },
    ...(tlPaid ? [{ key: "tlInr" as const, label: "Team Leader (INR)" }] : []),
    { key: "smInr", label: "Sales Manager (INR)" },
  ];
  const values = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])) as Record<keyof typeof form, number>;
  const bad = Object.values(values).some((n) => !Number.isFinite(n) || n < 0);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{course.name}</DialogTitle>
          <DialogDescription>What a sale of this course pays each position. Sales already counted keep their amounts.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input id={f.key} inputMode="decimal" value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <InrFields idPrefix="course" fields={inrFields} form={form} onChange={(k, v) => setForm((s) => ({ ...s, [k]: v }))} />
        {bad && <p className="text-sm text-destructive">Amounts are numbers, 0 or more.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={bad || save.isPending}
            onClick={() => save.mutate({ path: `courses/${course.id}`, body: { ...values, tl: tlPaid ? values.tl : 0, tlInr: tlPaid ? values.tlInr : 0 } })}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The rupee amounts of a course, in a dialog: what the part of a sale paid in rupees pays each position. */
function InrFields<K extends string>({ idPrefix, fields, form, onChange, note }: {
  idPrefix: string; fields: Array<{ key: K; label: string }>; form: Record<K, string>; onChange: (key: K, value: string) => void; note?: string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-sm font-medium">When the client pays in rupees</p>
      <p className="text-xs text-muted-foreground">
        The part of the fee paid in rupees pays these amounts in INR, the rest the AED ones. {note ?? "Left at 0, that part is paid at the AED amounts."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-${f.key}`}>{f.label}</Label>
            <Input id={`${idPrefix}-${f.key}`} inputMode="decimal" value={form[f.key]} onChange={(e) => onChange(f.key, e.target.value)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SlabDialog({ code, role, rows, onClose, path, title }: {
  code: string; role: (typeof SLAB_ROLES)[number]; rows: CommissionSlabRow[]; onClose: () => void;
  /** Where it saves: the portal's slab, or a team's own (2026-11-03). */
  path?: string;
  title?: string;
}) {
  const [list, setList] = useState(rows.map((r) => ({ name: r.name, target: String(r.target), salary: String(r.salary), percent: String(r.percent) })));
  const save = useSave(code, onClose);
  const parsed = list.map((r) => ({ name: r.name.trim(), target: Number(r.target), salary: Number(r.salary), percent: Number(r.percent) }));
  const problem = !parsed.length ? "A slab needs its base row"
    : parsed.some((r) => !r.name) ? "Each level needs a name"
    : parsed.some((r) => [r.target, r.salary, r.percent].some((n) => !Number.isFinite(n) || n < 0) || r.percent > 100) ? "Amounts are 0 or more; the percent at most 100"
    : parsed[0]!.target !== 0 ? "The first row is the base: its target must be 0"
    : parsed.some((r, i) => i > 0 && !(r.target > parsed[i - 1]!.target)) ? "Each level's target must be higher than the one before"
    : null;
  const set = (i: number, k: "name" | "target" | "salary" | "percent", v: string) => setList((l) => l.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title ?? `${role.label} slab`}</DialogTitle>
          <DialogDescription>
            The month&apos;s sales reach a level; the level pays its salary and that percent of the commission earned. The change is in force from this month (UAE); past months keep their slabs.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_1fr_80px_32px] gap-2 text-xs text-muted-foreground">
            <span>Level</span><span>From (AED)</span><span>Salary</span><span>Percent</span><span />
          </div>
          {list.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_80px_32px] gap-2">
              <Input aria-label="Level" value={r.name} onChange={(e) => set(i, "name", e.target.value)} />
              <Input aria-label="From" inputMode="decimal" value={r.target} disabled={i === 0} onChange={(e) => set(i, "target", e.target.value)} />
              <Input aria-label="Salary" inputMode="decimal" value={r.salary} onChange={(e) => set(i, "salary", e.target.value)} />
              <Input aria-label="Percent" inputMode="decimal" value={r.percent} onChange={(e) => set(i, "percent", e.target.value)} />
              <Button size="sm" variant="ghost" className="h-9 px-2" disabled={i === 0} aria-label="Remove level"
                onClick={() => setList((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={list.length >= 12}
            onClick={() => setList((l) => [...l, { name: "", target: "", salary: "", percent: "" }])}><Plus className="mr-1 h-3.5 w-3.5" /> Add a level</Button>
        </div>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!!problem || save.isPending} onClick={() => save.mutate({ path: path ?? `slabs/${role.key}`, body: { rows: parsed } })}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── A team on a plan of its own (the user, 2026-11-03: Team Legacy on its own, Titan and Maverick on the portal's) ── */

const hasOwnPlan = (t: CommissionTeamPlan) => t.courses.length > 0 || t.slabs.sales.length > 0 || t.slabs.tl.length > 0;

function TeamPlansCard({ code, tlPaid, root }: { code: string; tlPaid: boolean; root: RootCommissionPlan }) {
  const teams = root.teams ?? [];
  const [pick, setPick] = useState(() => (teams.find(hasOwnPlan) ?? teams.find((t) => t.status === "active") ?? teams[0])?.id ?? "");
  const team = teams.find((t) => t.id === pick) ?? teams[0];
  const [course, setCourse] = useState<RootCommissionPlan["courses"][number] | null>(null);
  const [slab, setSlab] = useState<(typeof SLAB_ROLES)[number] | null>(null);
  const undo = useSave(code, () => {});
  if (!team) return null;
  const own = new Map(team.courses.map((c) => [c.id, c]));
  // A team's own slabs: Sales Staff, and Team Leader where the portal has a TL slab — the Sales Manager is the portal's.
  const roles = SLAB_ROLES.filter((r) => r.key === "sales" || (r.key === "tl" && root.tlSlab));
  const base = `teams/${team.id}`;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Team plans</span>
          <select aria-label="Team" value={team.id} onChange={(e) => setPick(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm font-normal">
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{hasOwnPlan(t) ? " · own plan" : ""}{t.status && t.status !== "active" ? " (inactive)" : ""}{!t.inCrm ? " (no longer in the CRM)" : ""}
              </option>
            ))}
          </select>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A team can have its own amounts per course and its own Sales Staff{root.tlSlab ? " and Team Leader" : ""} slabs. Anything not set for it — and every
          team without a plan of its own — uses the plan above. Amounts count for sales from then on; a slab from this month.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Course — {team.name}</th>
                <th className="pb-2 pr-3 text-right font-medium">Sales Staff</th>
                {tlPaid && <th className="pb-2 pr-3 text-right font-medium">Team Leader</th>}
                <th className="pb-2 pr-3 text-right font-medium">Sales Manager</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {root.courses.map((c) => {
                const mine = own.get(c.id);
                const shown = mine ?? c;
                // The rupee amounts in force for this team: its own where it has any, else all teams'.
                const inrShown = mine && hasInr(mine, tlPaid) ? mine : c;
                const tone = mine ? "font-medium" : "text-muted-foreground";
                return (
                  <tr key={c.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium">{c.name}</span>
                      {mine ? <Badge className="ml-2">Team&apos;s own</Badge> : <span className="ml-2 text-xs text-muted-foreground">all teams&apos;</span>}
                      {mine?.updatedAt && <span className="block text-[11px] text-muted-foreground">changed {when(mine.updatedAt)} by {mine.updatedByEmail}</span>}
                    </td>
                    <td className={`whitespace-nowrap py-2.5 pr-3 text-right ${tone}`}>{aed(shown.sales)}<Inr n={inrShown.salesInr} /></td>
                    {tlPaid && <td className={`whitespace-nowrap py-2.5 pr-3 text-right ${tone}`}>{aed(shown.tl)}<Inr n={inrShown.tlInr} /></td>}
                    <td className={`whitespace-nowrap py-2.5 pr-3 text-right ${tone}`}>{aed(shown.sm)}<Inr n={inrShown.smInr} /></td>
                    <td className="whitespace-nowrap py-2.5 text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setCourse(c)} aria-label={`Set ${team.name}'s amounts for ${c.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                      {mine && (
                        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={undo.isPending} aria-label={`${c.name}: back on all teams' amounts`} title="Back on all teams' amounts"
                          onClick={() => undo.mutate({ path: `${base}/courses/${c.id}`, remove: true })}><Undo2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {roles.map((r) => {
            const mine = team.slabs[r.key as "sales" | "tl"];
            return (
              <div key={r.key}>
                {mine.length ? (
                  <>
                    <SlabTable label={`${r.label} — ${team.name}'s own${team.slabs.from ? ` from ${monthLabel(team.slabs.from)}` : ""}`} rows={mine} onEdit={() => setSlab(r)} />
                    <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" disabled={undo.isPending}
                      onClick={() => undo.mutate({ path: `${base}/slabs/${r.key}`, remove: true })}>
                      <Undo2 className="mr-1 h-3.5 w-3.5" /> Back on all teams&apos; slab from this month
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="opacity-70"><SlabTable label={`${r.label} — all teams'`} rows={root.slabs[r.key]} /></div>
                    <Button size="sm" variant="outline" className="mt-2 h-7" onClick={() => setSlab(r)}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Give {team.name} its own {r.label} slab
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      {course && <TeamCourseDialog code={code} tlPaid={tlPaid} team={team} course={course} own={own.get(course.id) ?? null} onClose={() => setCourse(null)} />}
      {slab && (
        <SlabDialog code={code} role={slab} onClose={() => setSlab(null)} path={`${base}/slabs/${slab.key}`} title={`${team.name} — ${slab.label} slab`}
          rows={team.slabs[slab.key as "sales" | "tl"].length ? team.slabs[slab.key as "sales" | "tl"] : root.slabs[slab.key]} />
      )}
    </Card>
  );
}

function TeamCourseDialog({ code, tlPaid, team, course, own, onClose }: {
  code: string; tlPaid: boolean; team: CommissionTeamPlan; course: RootCommissionPlan["courses"][number];
  own: CommissionTeamPlan["courses"][number] | null; onClose: () => void;
}) {
  const start = own ?? course;
  // The team's own rupee amounts; none of its own: 0, and its sales take all teams' rupee amounts.
  const [form, setForm] = useState({
    sales: String(start.sales), tl: String(start.tl), sm: String(start.sm),
    salesInr: String(own?.salesInr ?? 0), tlInr: String(own?.tlInr ?? 0), smInr: String(own?.smInr ?? 0),
  });
  const save = useSave(code, onClose);
  const fields: Array<{ key: keyof typeof form; label: string }> = [
    { key: "sales", label: "Sales Staff (AED)" },
    ...(tlPaid ? [{ key: "tl" as const, label: "Team Leader (AED)" }] : []),
    { key: "sm", label: "Sales Manager (AED)" },
  ];
  const inrFields: Array<{ key: keyof typeof form; label: string }> = [
    { key: "salesInr", label: "Sales Staff (INR)" },
    ...(tlPaid ? [{ key: "tlInr" as const, label: "Team Leader (INR)" }] : []),
    { key: "smInr", label: "Sales Manager (INR)" },
  ];
  const allTeamsInr = hasInr(course, tlPaid)
    ? `All left at 0, ${team.name} takes all teams' rupee amounts (INR ${money(course.salesInr ?? 0)}${tlPaid ? ` / INR ${money(course.tlInr ?? 0)}` : ""} / INR ${money(course.smInr ?? 0)}).`
    : undefined;
  const values = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])) as Record<keyof typeof form, number>;
  const bad = Object.values(values).some((n) => !Number.isFinite(n) || n < 0);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{course.name} — {team.name}</DialogTitle>
          <DialogDescription>
            What a sale of this course pays each position when it is {team.name}&apos;s. Other teams keep all teams&apos; amounts ({aed(course.sales)}
            {tlPaid ? ` / ${aed(course.tl)}` : ""} / {aed(course.sm)}). Sales already counted keep theirs.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`team-${f.key}`}>{f.label}</Label>
              <Input id={`team-${f.key}`} inputMode="decimal" value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <InrFields idPrefix="team" fields={inrFields} form={form} onChange={(k, v) => setForm((s) => ({ ...s, [k]: v }))} note={allTeamsInr} />
        {bad && <p className="text-sm text-destructive">Amounts are numbers, 0 or more.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={bad || save.isPending}
            onClick={() => save.mutate({ path: `teams/${team.id}/courses/${course.id}`, body: { ...values, tl: tlPaid ? values.tl : 0, tlInr: tlPaid ? values.tlInr : 0 } })}>
            {save.isPending ? "Saving…" : `Save for ${team.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PeopleDialog({ code, root, onClose }: { code: string; root: RootCommissionPlan; onClose: () => void }) {
  const [sm, setSm] = useState(root.salesManager?.id ?? "");
  const [excluded, setExcluded] = useState<string[]>(root.excluded.map((p) => p.id));
  const [q, setQ] = useState("");
  const save = useSave(code, onClose);
  // Whoever is chosen stays listed even after leaving the CRM's active people.
  const everyone = [...root.people, ...[root.salesManager, ...root.excluded].filter((p): p is NonNullable<typeof p> => !!p && !root.people.some((x) => x.id === p.id))];
  const shown = everyone.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sales Manager and who earns nothing</DialogTitle>
          <DialogDescription>The Sales Manager earns the SM line on every sale. A login that earns nothing — a shared login, say — gets no commission.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="sm">Sales Manager</Label>
          <select id="sm" value={sm} onChange={(e) => setSm(e.target.value)} className={SELECT}>
            <option value="">No Sales Manager</option>
            {everyone.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="who">Earn nothing</Label>
          <Input id="who" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {shown.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={excluded.includes(p.id)}
                  onChange={(e) => setExcluded((l) => (e.target.checked ? [...l, p.id] : l.filter((id) => id !== p.id)))} />
                {p.name}
              </label>
            ))}
            {!shown.length && <p className="text-sm text-muted-foreground">No one matches.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate({ path: "settings", body: { salesManager: sm || null, excluded } })}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Root's figures beside the CRM's (2026-11-01, stage 2) ──────────────────────────────────────────────────────── */

const ROLE_SHORT: Record<string, string> = { sales: "Sales Staff", tl: "Team Leader", sm: "Sales Manager" };
/** Every month from October 2026 (when commission starts) to this one, newest first. */
function payMonths(): string[] {
  const now = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 7);
  const out: string[] = [];
  for (let m = "2026-10"; m <= now; ) {
    out.unshift(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y! + 1}-01` : `${y}-${String(mo! + 1).padStart(2, "0")}`;
  }
  return out;
}
const linesText = (ls: Array<{ role: string; userName: string; amount: number }>) =>
  ls.length ? ls.map((l) => `${ROLE_SHORT[l.role] ?? l.role} ${l.userName} ${aed(l.amount)}`).join(" · ") : "nobody";

function CompareCard({ code, name }: { code: string; name: string }) {
  const months = payMonths();
  const [month, setMonth] = useState(months[0]!);
  const [asked, setAsked] = useState<string | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(true);
  const q = useQuery({
    queryKey: ["commission-compare", code, asked],
    queryFn: async () => (await api.get(`/commission-plans/${code}/compare?month=${asked}`)).data.data as CommissionCompare,
    enabled: !!asked,
    retry: false,
  });
  const d = q.data;
  const people = (d?.pay.people ?? []).filter((p) => !onlyDiff || !p.same);
  const sales = (d?.sales.list ?? []).filter((s) => !onlyDiff || !s.same);
  const cell = (crm: number | string | undefined, root: number | string | undefined, fmt: (v: number | string) => string = String) => (
    <td className="whitespace-nowrap py-2 pr-3 text-right">
      {root === undefined ? "—" : fmt(root)}
      {crm !== undefined && crm !== root && <span className="block text-[11px] text-amber-600 dark:text-amber-400">CRM: {fmt(crm)}</span>}
    </td>
  );
  const money2 = (v: number | string) => aed(Number(v));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Root&apos;s figures beside {name}&apos;s</CardTitle>
        <p className="text-sm text-muted-foreground">
          My Pay and who earns what, worked out by Root from the plan above, next to what {name} gives now. Use it to check Root agrees before {name} is switched to Root&apos;s figures.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <Button size="sm" onClick={() => { setAsked(month); if (asked === month) void q.refetch(); }} disabled={q.isFetching}>
            {q.isFetching ? "Comparing…" : "Compare"}
          </Button>
          {d && (
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only differences
            </label>
          )}
        </div>
        {q.error && <p className="text-sm text-destructive">{apiErrorMessage(q.error, "Could not compare")}</p>}
        {d && (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant={d.pay.differ ? "warning" : "success"}>My Pay: {d.pay.differ ? `${d.pay.differ} of ${d.pay.people.length} people differ` : `all ${d.pay.people.length} the same`}</Badge>
              <Badge variant={d.sales.differ ? "warning" : "success"}>Sales: {d.sales.differ ? `${d.sales.differ} of ${d.sales.list.length} differ` : `all ${d.sales.list.length} the same`}</Badge>
            </div>
            {d.pay.crmError && <p className="text-sm text-amber-600 dark:text-amber-400">{name}&apos;s own My Pay couldn&apos;t be had: {d.pay.crmError}. Root&apos;s figures are shown alone.</p>}
            {people.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Person</th>
                      <th className="pb-2 pr-3 font-medium">Position</th>
                      <th className="pb-2 pr-3 text-right font-medium">Target (Root)</th>
                      <th className="pb-2 pr-3 text-right font-medium">Level</th>
                      <th className="pb-2 pr-3 text-right font-medium">%</th>
                      <th className="pb-2 pr-3 text-right font-medium">Earned</th>
                      <th className="pb-2 pr-3 text-right font-medium">Waiting</th>
                      <th className="pb-2 text-right font-medium">Payable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.user} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{p.name}</span>
                          {!p.crm && !d.pay.crmError && <span className="block text-[11px] text-amber-600 dark:text-amber-400">Not on the CRM&apos;s My Pay</span>}
                          {!p.root && <span className="block text-[11px] text-amber-600 dark:text-amber-400">Not on Root&apos;s</span>}
                        </td>
                        <td className="py-2 pr-3">
                          {ROLE_SHORT[p.root?.role ?? p.crm?.role ?? ""] ?? "—"}
                          {p.crm && p.root && p.crm.role !== p.root.role && <span className="block text-[11px] text-amber-600 dark:text-amber-400">CRM: {ROLE_SHORT[p.crm.role] ?? p.crm.role}</span>}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">{p.root ? aed(p.root.target) : "—"}</td>
                        {cell(p.crm?.level, p.root?.level)}
                        {cell(p.crm?.percent, p.root?.percent, (v) => `${v}%`)}
                        {cell(p.crm?.earned, p.root?.earned, money2)}
                        {cell(p.crm?.balance, p.root?.balance, money2)}
                        {cell(p.crm?.payable, p.root?.payable, money2)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sales.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Who earns what on {monthLabel(d.month)}&apos;s sales</p>
                <ul className="space-y-2 text-sm">
                  {sales.map((s) => (
                    <li key={s.saleId} className="rounded-md border border-border p-2.5">
                      <p className="font-medium">{s.student} <span className="font-normal text-muted-foreground">· {s.course}{s.saleDate ? ` · ${s.saleDate.slice(0, 10)}` : ""}</span></p>
                      <p className="mt-1 text-xs"><span className="text-muted-foreground">CRM ({s.crm.state}):</span> {linesText(s.crm.lines)}</p>
                      <p className={`text-xs ${s.same ? "" : "text-amber-600 dark:text-amber-400"}`}>
                        <span className="text-muted-foreground">Root ({s.root.state}):</span> {linesText(s.root.lines)}{s.root.reason ? ` — ${s.root.reason}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">A sale keeps the amounts of the plan it was counted under, so a plan change since shows here as a difference — expected, not a fault.</p>
              </div>
            )}
            {!people.length && !sales.length && <p className="text-sm text-muted-foreground">{onlyDiff ? "No differences." : "Nothing this month."}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Today's slabs applied to an earlier month (the user, 2026-11-01: "a button to apply them to October") ──────── */

interface ApplyPreview {
  month: string;
  from: string;
  unchanged: number;
  totals: { before: number; after: number };
  people: Array<{
    user: string;
    name: string;
    before: { role: string; level: string; percent: number; salary: number; payable: number; total: number } | null;
    after: { role: string; level: string; percent: number; salary: number; payable: number; total: number } | null;
  }>;
}

function ApplyFromDialog({ code, name, from, months, onClose }: { code: string; name: string; from: string; months: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(months[0]!);
  const preview = useQuery({
    queryKey: ["commission-apply-from", code, month],
    queryFn: async () => (await api.get(`/commission-plans/${code}/slabs/apply-from?month=${month}`)).data.data as ApplyPreview,
    retry: false,
  });
  const apply = useMutation({
    mutationFn: async () => (await api.post(`/commission-plans/${code}/slabs/apply-from`, { month })).data.data as CrmCommissionPlan[],
    onSuccess: (data) => {
      qc.setQueryData(["commission-plans"], data);
      void qc.invalidateQueries({ queryKey: ["commission-compare"] });
      toast.success(`Slabs in force from ${monthLabel(month)}`);
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not apply the slabs")),
  });
  const d = preview.data;
  const pay = (v: number) => aed(v);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Apply these slabs to an earlier month</DialogTitle>
          <DialogDescription>
            The slabs in force since {monthLabel(from)} are put in force from the month you choose, for {name}. That month&apos;s My Pay — and
            finance&apos;s payable — follow at once. Payouts finance has approved already stay as approved and show as changed.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Label htmlFor="apply-month">From</Label>
          <select id="apply-month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        {preview.isLoading && <Skeleton className="h-32 w-full" />}
        {preview.error && <p className="text-sm text-destructive">{apiErrorMessage(preview.error, "Could not work out the preview")}</p>}
        {d && (
          <div className="space-y-2">
            <p className="text-sm">
              {d.people.length
                ? `${d.people.length} ${d.people.length === 1 ? "person's" : "people's"} pay for ${monthLabel(d.month)} changes; ${d.unchanged} stay the same. Total pay ${pay(d.totals.before)} → ${pay(d.totals.after)}.`
                : `Nobody's pay for ${monthLabel(d.month)} changes.`}
            </p>
            {d.people.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Person</th>
                      <th className="pb-2 pr-3 font-medium">Level</th>
                      <th className="pb-2 pr-3 text-right font-medium">Salary</th>
                      <th className="pb-2 pr-3 text-right font-medium">Payable</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.people.map((p) => (
                      <tr key={p.user} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{p.name}</span>
                          <span className="block text-[11px] text-muted-foreground">{ROLE_SHORT[p.after?.role ?? p.before?.role ?? ""] ?? ""}</span>
                        </td>
                        <td className="py-2 pr-3">{p.before ? `${p.before.level} ${p.before.percent}%` : "—"} → <span className="font-medium">{p.after ? `${p.after.level} ${p.after.percent}%` : "—"}</span></td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">{p.before ? money(p.before.salary) : "—"} → {p.after ? money(p.after.salary) : "—"}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">{p.before ? money(p.before.payable) : "—"} → {p.after ? money(p.after.payable) : "—"}</td>
                        <td className="whitespace-nowrap py-2 text-right font-medium">{p.before ? money(p.before.total) : "—"} → {p.after ? money(p.after.total) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!d || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? "Applying…" : `Apply from ${monthLabel(month)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
