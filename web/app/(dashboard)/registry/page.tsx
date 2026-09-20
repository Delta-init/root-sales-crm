"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Building2, Check, GraduationCap, Loader2, Pencil, Plus, Server, Wallet, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { RegistryTarget, TargetKind } from "@/lib/types";

/**
 * The registry: everywhere the portal can send somebody.
 *
 * Three CRMs, two finance organizations and HRMS. Each row says where the
 * system lives, which account the portal signs in as, and whether it is on.
 * Until a target has an address and a service account, a launch into it fails
 * with a message nobody can act on — this is where that gets fixed.
 *
 * The codes are a fixed list rather than free text: an access row, an audit
 * entry and each CRM's own configuration all refer to a target by that string,
 * so inventing one here would produce a row nothing else knows about. Adding a
 * genuinely new system is a change to the code, deliberately.
 */

const KIND: Record<TargetKind, { label: string; icon: typeof Building2; className: string }> = {
  crm: { label: "Sales CRM", icon: Building2, className: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  finance: { label: "Finance", icon: Wallet, className: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  hrms: { label: "HRMS", icon: GraduationCap, className: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
};

/** The six the rest of the estate already knows by name. */
const KNOWN_CODES = [
  { code: "delta", name: "Delta CRM", kind: "crm" },
  { code: "banglore", name: "Banglore CRM", kind: "crm" },
  { code: "draw", name: "Draw CRM", kind: "crm" },
  { code: "finance-hq", name: "Delta HQ Finance", kind: "finance" },
  { code: "finance-banglore", name: "Banglore Finance", kind: "finance" },
  { code: "hrms", name: "Delta HRMS", kind: "hrms" },
] as const;

type Draft = Partial<RegistryTarget> & { mongoUri?: string; ssoSecret?: string };

export default function RegistryPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);

  const targets = useQuery({
    queryKey: ["registry"],
    queryFn: async () => (await api.get<{ data: RegistryTarget[] }>("/orgs/all")).data.data,
  });

  const registered = new Set((targets.data ?? []).map((t) => t.code));
  const missing = KNOWN_CODES.filter((k) => !registered.has(k.code));

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2">
          <Server className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Registry</h1>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Everywhere the portal can send somebody, and how it reaches each one
        </p>
      </motion.div>

      {/* Said up front: a target nobody has registered is the reason a launch
          into it fails, and that is not obvious from the failure. */}
      {missing.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <p className="flex-1 text-sm">
              <span className="font-medium">
                {missing.length} system{missing.length === 1 ? " is" : "s are"} not registered yet
              </span>
              <span className="text-muted-foreground">
                {" "}— nobody can be sent to {missing.length === 1 ? "it" : "them"} until{" "}
                {missing.length === 1 ? "it has" : "they have"} an address and a service account.
              </span>
            </p>
            {missing.map((m) => (
              <Button
                key={m.code}
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => { setIsNew(true); setEditing({ code: m.code, name: m.name, kind: m.kind }); }}
              >
                <Plus className="h-3.5 w-3.5" /> {m.name}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {targets.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {targets.data?.map((t) => {
            const k = KIND[t.kind] ?? KIND.crm;
            const Icon = k.icon;
            // What actually stops a launch working, said plainly.
            const gaps = [
              !t.appUrl && "no address",
              !t.serviceEmail && "no service account",
            ].filter(Boolean) as string[];

            return (
              <Card key={t.code} className={cn(!t.isActive && "opacity-60")}>
                <CardContent className="flex flex-wrap items-start gap-4 p-4">
                  <div className={cn("rounded-lg border p-2", k.className)}>
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-[180px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{t.name}</p>
                      <Badge variant="outline" className="text-[10px]">{k.label}</Badge>
                      {!t.isActive && <Badge variant="outline">Off</Badge>}
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">{t.code}</p>
                    {gaps.length > 0 && (
                      <p className="mt-1 text-xs text-amber-400">
                        Cannot be launched into — {gaps.join(" and ")}.
                      </p>
                    )}
                  </div>

                  <div className="flex-[2] space-y-1 text-xs text-muted-foreground">
                    <Row label="App" value={t.appUrl} />
                    <Row label="API" value={t.apiUrl} />
                    <Row label="Signs in as" value={t.serviceEmail} />
                    <div className="flex flex-wrap gap-3 pt-0.5">
                      <Flag on={t.hasSsoSecret} label="SSO secret" />
                      {t.kind === "crm" && <Flag on={t.hasMongoUri} label="Report access" />}
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => { setIsNew(false); setEditing(t); }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <EditDialog
        draft={editing}
        isNew={isNew}
        onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ["registry"] }); }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 opacity-70">{label}</span>
      <span className={cn("truncate", !value && "italic opacity-50")}>{value || "not set"}</span>
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", on ? "text-emerald-400" : "text-muted-foreground")}>
      {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </span>
  );
}

function EditDialog({
  draft, isNew, onClose, onDone,
}: {
  draft: Draft | null;
  isNew: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState<Draft>({});
  const [error, setError] = useState("");
  const [seeded, setSeeded] = useState<string | null>(null);

  // Reseed when a different target is opened, without clobbering typing.
  if (draft && seeded !== draft.code) {
    setSeeded(draft.code ?? null);
    setForm({ ...draft, mongoUri: "", ssoSecret: "" });
    setError("");
  }

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        kind: form.kind, name: form.name, appUrl: form.appUrl, apiUrl: form.apiUrl,
        timezone: form.timezone || "Asia/Dubai", currency: form.currency || "AED",
        fxToBase: form.fxToBase ?? 1, serviceEmail: form.serviceEmail,
        isActive: form.isActive ?? true,
      };
      // Sent only when typed: blank means "leave what is stored".
      if (form.mongoUri?.trim()) body["mongoUri"] = form.mongoUri.trim();
      if (form.ssoSecret?.trim()) body["ssoSecret"] = form.ssoSecret.trim();

      return isNew
        ? api.post("/orgs", { ...body, code: form.code })
        : api.patch(`/orgs/${form.code}`, body);
    },
    onSuccess: onDone,
    onError: (e: unknown) => {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "That could not be saved",
      );
    },
  });

  const set = (k: keyof Draft) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={Boolean(draft)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? `Register ${draft?.name}` : `Edit ${draft?.name}`}</DialogTitle>
          <DialogDescription>
            The address people are sent to, and the account the portal signs in as. That account has
            to exist in the target already — SSO will not create it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Name" value={form.name ?? ""} onChange={set("name")} />
          <Field
            label="App address"
            value={form.appUrl ?? ""}
            onChange={set("appUrl")}
            placeholder="https://finance.deltainstitutions.com"
            hint="Where somebody lands. The portal sends them to /sso here."
          />
          <Field
            label="API address"
            value={form.apiUrl ?? ""}
            onChange={set("apiUrl")}
            placeholder="https://api-finance.deltainstitutions.com"
          />
          <Field
            label="Service account"
            value={form.serviceEmail ?? ""}
            onChange={set("serviceEmail")}
            placeholder="root@deltainstitutions.com"
            hint="Who a root admin arrives as. Members arrive as themselves."
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timezone" value={form.timezone ?? "Asia/Dubai"} onChange={set("timezone")} />
            <Field label="Currency" value={form.currency ?? "AED"} onChange={set("currency")} />
          </div>

          <Field
            label={draft?.hasSsoSecret ? "SSO secret (set — type to replace)" : "SSO secret"}
            value={form.ssoSecret ?? ""}
            onChange={set("ssoSecret")}
            placeholder={draft?.hasSsoSecret ? "•••••••• leave blank to keep" : ""}
            type="password"
          />
          {form.kind === "crm" && (
            <Field
              label={draft?.hasMongoUri ? "Report connection (set — type to replace)" : "Report connection"}
              value={form.mongoUri ?? ""}
              onChange={set("mongoUri")}
              placeholder={draft?.hasMongoUri ? "•••••••• leave blank to keep" : "mongodb://…"}
              type="password"
              hint="Read-only, used by the group report."
            />
          )}

          <label className="flex items-center gap-2 pt-1 text-sm">
            <input
              type="checkbox"
              checked={form.isActive ?? true}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Active — anybody with access may open it
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!form.name?.trim() || save.isPending}
            onClick={() => save.mutate()}
            className="gap-1.5"
          >
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isNew ? "Register" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, value, onChange, placeholder, hint, type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
