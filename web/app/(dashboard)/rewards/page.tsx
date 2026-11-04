"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { Gift, ImageIcon, Loader2, Plus, Save, Trash2, Trophy, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { API_URL, api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";

/**
 * Gift rewards (the user, 2026-11-04): a salesperson who closes AED 50,000 in a month chooses a gift worth up to
 * AED 2,000 in their CRM's pop-up; a team leader whose team closes AED 100,000, one worth up to AED 3,000. One gift a
 * person a month. Here root admins set the targets, keep the gifts on the shelf, and see every gift chosen through to
 * handing it over.
 */

type Status = "requested" | "ordered" | "handed_over" | "cancelled";
interface Settings { enabled: boolean; salesTargetAed: number; salesGiftAed: number; tlTargetAed: number; tlGiftAed: number; inrPerAed: number }
interface GiftRow { id: string; name: string; category: string; valueAed: number; active: boolean; order: number; photoVersion: number }
interface Claim {
  id: string; portal: string; month: string; userId: string; userName: string; role: "sales" | "tl"; teamName: string;
  achievedAed: number; achieved: number; currency: string; targetAed: number;
  giftId: string; giftName: string; giftCategory: string; giftValueAed: number;
  status: Status; note: string; createdAt: string; updatedAt: string;
  history: Array<{ status: Status; at: string; by: string }>;
}
interface Overview {
  month: string; currentMonth: string; months: string[]; settings: Settings; gifts: GiftRow[]; claims: Claim[];
  portals: Array<{ code: string; name: string }>;
}

const STATUSES: Array<{ value: Status; label: string }> = [
  { value: "requested", label: "Chosen, to order" },
  { value: "ordered", label: "Ordered" },
  { value: "handed_over", label: "Handed over" },
  { value: "cancelled", label: "Cancelled" },
];
const statusLabel = (s: Status) => STATUSES.find((x) => x.value === s)?.label ?? s;
const SETTING_FIELDS: Array<{ key: keyof Omit<Settings, "enabled">; label: string; step: number }> = [
  { key: "salesTargetAed", label: "Salesperson's target in a month (AED)", step: 1000 },
  { key: "salesGiftAed", label: "Their gift, worth up to (AED)", step: 100 },
  { key: "tlTargetAed", label: "Team leader: the team's target (AED)", step: 1000 },
  { key: "tlGiftAed", label: "Their gift, worth up to (AED)", step: 100 },
  { key: "inrPerAed", label: "Rupees to one dirham (Bangalore CRM)", step: 0.01 },
];
const PHOTO_TYPES = "image/jpeg,image/png,image/webp";
/** Root keeps a photo up to 600 KB; the browser makes it smaller first. */
const PHOTO_MAX_BYTES = 600 * 1024;

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;
const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};
const day = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
const photoUrl = (g: Pick<GiftRow, "id" | "photoVersion">) => `${API_URL}/public/rewards/photos/${g.id}?v=${g.photoVersion}`;

/** A photo made at most 1200 px on its long side and a JPEG small enough for Root, as a data: URL. */
async function shrinkPhoto(file: File): Promise<string> {
  if (!PHOTO_TYPES.split(",").includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That photo couldn't be read"));
      i.src = url;
    });
    const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't make the photo smaller");
    // A see-through PNG would turn black as a JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.76, 0.66, 0.5]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if ((data.length - data.indexOf(",") - 1) * 0.75 <= PHOTO_MAX_BYTES) return data;
    }
    throw new Error("That photo is too big, even made smaller");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function RewardsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState("");
  const [portal, setPortal] = useState("all");
  const q = useQuery({
    queryKey: ["rewards", month],
    queryFn: async () => (await api.get("/rewards", { params: month ? { month } : {} })).data.data as Overview,
    refetchInterval: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rewards"] });
  const o = q.data;

  // ── The targets ──
  const [form, setForm] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (o && !form) setForm(Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, String(o.settings[f.key])])));
  }, [o, form]);
  const dirty = !!o && !!form && SETTING_FIELDS.some((f) => Number(form[f.key]) !== o.settings[f.key]);
  const settings = useMutation({
    mutationFn: async (body: Partial<Settings>) => (await api.put("/rewards/settings", body)).data.data as Settings,
    onSuccess: (s, body) => {
      toast.success(body.enabled === undefined ? "Targets saved" : body.enabled ? "Gift rewards are on" : "Gift rewards are off");
      setForm(Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, String(s[f.key])])));
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Not saved")),
  });
  const saveTargets = () => {
    if (!form) return;
    settings.mutate(Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, Number(form[f.key])])) as Partial<Settings>);
  };

  // ── The gifts ──
  const patchGift = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Partial<GiftRow> }) => (await api.patch(`/rewards/gifts/${id}`, body)).data,
    onSuccess: refresh,
  });
  const giftPhoto = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => (await api.put(`/rewards/gifts/${id}/photo`, { data: await shrinkPhoto(file) })).data,
    onSuccess: () => { toast.success("Photo saved"); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, (e as Error).message || "The photo wasn't saved")),
  });
  const removeGift = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/rewards/gifts/${id}`)).data as { message: string },
    onSuccess: (r) => { toast.success(r.message); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Not removed")),
  });
  /** A field saved when the box is left; a refusal puts back what was there. */
  const saveField = (g: GiftRow, key: "name" | "category" | "valueAed", el: HTMLInputElement) => {
    const before = String(g[key]);
    const raw = el.value.trim();
    if (!raw || raw === before) { el.value = before; return; }
    patchGift.mutate(
      { id: g.id, body: { [key]: key === "valueAed" ? Number(raw) : raw } },
      { onError: (e) => { el.value = before; toast.error(apiErrorMessage(e, "Not saved")); } },
    );
  };

  const [add, setAdd] = useState({ name: "", category: "", valueAed: "", file: null as File | null });
  /** Bumped after a gift goes in, so the file box empties too. */
  const [addRound, setAddRound] = useState(0);
  const addGift = useMutation({
    mutationFn: async () => {
      const photo = add.file ? { data: await shrinkPhoto(add.file) } : undefined;
      return (await api.post("/rewards/gifts", { name: add.name, category: add.category, valueAed: Number(add.valueAed), photo })).data;
    },
    onSuccess: () => { toast.success(`${add.name.trim()} is on the shelf`); setAdd({ name: "", category: "", valueAed: "", file: null }); setAddRound((n) => n + 1); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, (e as Error).message || "Not added")),
  });

  // ── The gifts chosen ──
  const patchClaim = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { status?: Status; note?: string } }) => (await api.patch(`/rewards/claims/${id}`, body)).data,
    onSuccess: refresh,
    onError: (e) => { toast.error(apiErrorMessage(e, "Not saved")); refresh(); },
  });

  const claims = useMemo(() => (o?.claims ?? []).filter((c) => portal === "all" || c.portal === portal), [o, portal]);
  const counts = useMemo(() => {
    const live = claims.filter((c) => c.status !== "cancelled");
    return {
      requested: claims.filter((c) => c.status === "requested").length,
      ordered: claims.filter((c) => c.status === "ordered").length,
      handed: claims.filter((c) => c.status === "handed_over").length,
      value: live.reduce((n, c) => n + c.giftValueAed, 0),
    };
  }, [claims]);
  const portalName = (code: string) => o?.portals.find((p) => p.code === code)?.name ?? code;
  const categories = useMemo(() => Array.from(new Set((o?.gifts ?? []).map((g) => g.category))).sort(), [o]);

  if (forbidden(q.error)) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">Gift rewards are for root admins.</CardContent></Card>;
  }

  const tier = (g: GiftRow) => {
    if (!o) return null;
    if (g.valueAed <= o.settings.salesGiftAed) return <Badge variant="success">Everyone</Badge>;
    if (g.valueAed <= o.settings.tlGiftAed) return <Badge variant="warning">Team leaders</Badge>;
    return <Badge variant="destructive">Worth more than any target</Badge>;
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Gift className="h-6 w-6 text-primary" /> Gift rewards
        </h2>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          In the four sales CRMs, whoever reaches their target in the month chooses a gift from the shelf below, up to their
          target&apos;s value, one a month. What they closed is counted the way each CRM&apos;s leaderboard counts it. Sales
          Managers and people in no team don&apos;t take part.
        </p>
      </motion.div>

      {notYet(q.error) && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">The portal&apos;s server is still on the previous version, so this page has nothing to show yet. It works once the server is updated.</CardContent></Card>
      )}
      {q.error && !forbidden(q.error) && !notYet(q.error) && (
        <Card><CardContent className="pt-6 text-sm text-destructive">{apiErrorMessage(q.error, "Gift rewards couldn't be loaded")}</CardContent></Card>
      )}

      {/* The targets */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4" /> Targets</CardTitle>
          {o && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={o.settings.enabled} disabled={settings.isPending}
                onChange={(e) => settings.mutate({ enabled: e.target.checked })} />
              {o.settings.enabled ? "On in every sales CRM" : "Off: nobody sees the pop-up"}
            </label>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!o || !form ? <Skeleton className="h-24 w-full" /> : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {SETTING_FIELDS.map((f) => (
                  <label key={f.key} className="space-y-1.5 text-sm">
                    <span className="block text-muted-foreground">{f.label}</span>
                    <Input type="number" min={1} step={f.step} value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={saveTargets} disabled={!dirty || settings.isPending}>
                  {settings.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save targets
                </Button>
                {dirty && (
                  <Button variant="ghost" onClick={() => setForm(Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, String(o.settings[f.key])])))}>
                    Undo changes
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  The Bangalore CRM counts in rupees: its salesperson target is {inr(o.settings.salesTargetAed * o.settings.inrPerAed)} and
                  its team target {inr(o.settings.tlTargetAed * o.settings.inrPerAed)}. Gift values stay in AED everywhere.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* The gifts chosen */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Gifts chosen</CardTitle>
            {o && (
              <select value={o.month} onChange={(e) => setMonth(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                {o.months.map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}{m === o.currentMonth ? " (this month)" : ""}</option>
                ))}
              </select>
            )}
          </div>
          {o && (
            <div className="flex flex-wrap items-center gap-1.5">
              {[{ code: "all", name: "All CRMs" }, ...o.portals].map((p) => (
                <button key={p.code} type="button" onClick={() => setPortal(p.code)}
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs", portal === p.code ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  {p.name} · {(p.code === "all" ? o.claims : o.claims.filter((c) => c.portal === p.code)).length}
                </button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!o ? <Skeleton className="h-32 w-full" /> : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "To order", value: String(counts.requested) },
                  { label: "Ordered", value: String(counts.ordered) },
                  { label: "Handed over", value: String(counts.handed) },
                  { label: "Worth, not cancelled", value: aed(counts.value) },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-lg font-semibold tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>
              {!claims.length ? (
                <p className="text-sm text-muted-foreground">Nobody has chosen a gift in {monthLabel(o.month)}{portal === "all" ? "" : ` in ${portalName(portal)}`} yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Person</th>
                        <th className="py-2 pr-4 font-medium">CRM</th>
                        <th className="py-2 pr-4 font-medium">Closed</th>
                        <th className="py-2 pr-4 font-medium">Gift</th>
                        <th className="py-2 pr-4 font-medium">Chosen</th>
                        <th className="py-2 pr-4 font-medium">Where it is</th>
                        <th className="py-2 font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claims.map((c) => (
                        <tr key={c.id} className={cn("border-t align-top", c.status === "cancelled" && "opacity-60")}>
                          <td className="py-2 pr-4">
                            <p className="font-medium">{c.userName || "—"}</p>
                            <p className="text-xs text-muted-foreground">{c.role === "tl" ? "Team leader" : "Salesperson"}{c.teamName ? ` · ${c.teamName}` : ""}</p>
                          </td>
                          <td className="py-2 pr-4">{portalName(c.portal)}</td>
                          <td className="py-2 pr-4 tabular-nums">
                            {c.currency === "INR" ? (
                              <>
                                <p>{inr(c.achieved)}</p>
                                <p className="text-xs text-muted-foreground">≈ {aed(c.achievedAed)} · target {aed(c.targetAed)}</p>
                              </>
                            ) : (
                              <>
                                <p>{aed(c.achievedAed)}</p>
                                <p className="text-xs text-muted-foreground">target {aed(c.targetAed)}</p>
                              </>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            <p className="font-medium">{c.giftName}</p>
                            <p className="text-xs text-muted-foreground">{c.giftCategory} · {aed(c.giftValueAed)}</p>
                          </td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{day(c.createdAt)}</td>
                          <td className="py-2 pr-4">
                            <select value={c.status} disabled={patchClaim.isPending}
                              title={c.history.map((h) => `${statusLabel(h.status)} · ${day(h.at)}${h.by ? ` · ${h.by}` : ""}`).join("\n")}
                              onChange={(e) => patchClaim.mutate({ id: c.id, body: { status: e.target.value as Status } })}
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                            {c.history.length > 1 && (
                              <p className="mt-1 text-xs text-muted-foreground">since {day(c.history[c.history.length - 1]!.at)}</p>
                            )}
                          </td>
                          <td className="py-2">
                            <Input key={`${c.id}:${c.note}`} defaultValue={c.note} placeholder="Order no., size, where to collect…" maxLength={300} className="h-8 min-w-48"
                              onBlur={(e) => e.target.value.trim() !== c.note && patchClaim.mutate({ id: c.id, body: { note: e.target.value } })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* The shelf */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The shelf</CardTitle>
          <p className="text-sm text-muted-foreground">
            {o ? <>Salespeople see the gifts worth up to {aed(o.settings.salesGiftAed)}, team leaders the ones up to {aed(o.settings.tlGiftAed)}. A gift taken off the shelf stays on the requests that chose it.</> : null}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {!o ? <Skeleton className="h-64 w-full" /> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {o.gifts.map((g) => (
                <div key={g.id} className={cn("overflow-hidden rounded-xl border bg-card", !g.active && "opacity-60")}>
                  <div className="relative aspect-[4/3] bg-muted">
                    {g.photoVersion ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl(g)} alt={g.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-8 w-8" /></div>
                    )}
                    <label className="absolute bottom-2 right-2 flex cursor-pointer items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs font-medium shadow hover:bg-background">
                      {giftPhoto.isPending && giftPhoto.variables?.id === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {g.photoVersion ? "Change photo" : "Add a photo"}
                      <input type="file" accept={PHOTO_TYPES} className="hidden"
                        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) giftPhoto.mutate({ id: g.id, file }); }} />
                    </label>
                  </div>
                  <div className="space-y-2 p-3">
                    <Input defaultValue={g.name} aria-label="Name" className="h-8 font-medium" onBlur={(e) => saveField(g, "name", e.currentTarget)} />
                    <div className="flex gap-2">
                      <Input defaultValue={g.category} aria-label="Category" list="reward-categories" className="h-8" onBlur={(e) => saveField(g, "category", e.currentTarget)} />
                      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        AED
                        <Input type="number" min={1} defaultValue={g.valueAed} aria-label="Value in AED" className="h-8 w-24"
                          onBlur={(e) => saveField(g, "valueAed", e.currentTarget)} />
                      </label>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {tier(g)}
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={g.active}
                            onChange={(e) => patchGift.mutate({ id: g.id, body: { active: e.target.checked } }, { onError: (err) => toast.error(apiErrorMessage(err, "Not saved")) })} />
                          On the shelf
                        </label>
                        <Button variant="ghost" size="icon" aria-label="Remove" className="h-8 w-8 text-destructive" disabled={removeGift.isPending}
                          onClick={() => window.confirm(`Remove "${g.name}" from the shelf?`) && removeGift.mutate(g.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <datalist id="reward-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>

          {o && (
            <div className="rounded-xl border border-dashed p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium"><Plus className="h-4 w-4" /> Add a gift</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1.5 text-sm">
                  <span className="block text-muted-foreground">Name</span>
                  <Input value={add.name} maxLength={80} placeholder="e.g. Apple Watch SE" className="w-56" onChange={(e) => setAdd({ ...add, name: e.target.value })} />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="block text-muted-foreground">Category</span>
                  <Input value={add.category} maxLength={40} list="reward-categories" placeholder="e.g. Electronics" className="w-44" onChange={(e) => setAdd({ ...add, category: e.target.value })} />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="block text-muted-foreground">Worth (AED)</span>
                  <Input type="number" min={1} value={add.valueAed} className="w-28" onChange={(e) => setAdd({ ...add, valueAed: e.target.value })} />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="block text-muted-foreground">Photo</span>
                  <Input key={addRound} type="file" accept={PHOTO_TYPES} className="w-60" onChange={(e) => setAdd({ ...add, file: e.target.files?.[0] ?? null })} />
                </label>
                <Button onClick={() => addGift.mutate()} disabled={addGift.isPending || !add.name.trim() || !add.category.trim() || !(Number(add.valueAed) > 0)}>
                  {addGift.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Add
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
