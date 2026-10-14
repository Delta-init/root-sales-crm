/*
 * 3CX calls on Root (2026-10-14): Dubai days for the periods, and talk time as
 * people read it. Shared by the Pending page and the 3CX calls page.
 */

const UAE_MS = 4 * 3_600_000;
/** Today on the Dubai calendar, YYYY-MM-DD. */
export const dubaiToday = () => new Date(Date.now() + UAE_MS).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const CALL_PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
] as const;
export type CallPeriod = (typeof CALL_PERIODS)[number]["key"] | "custom";

/** A period's Dubai days. */
export function periodDays(key: CallPeriod, custom?: { from?: string; to?: string }): { from: string; to: string } {
  const today = dubaiToday();
  switch (key) {
    case "today": return { from: today, to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: `${today.slice(0, 7)}-01`, to: today };
    case "custom": return { from: custom?.from || today, to: custom?.to || today };
    default: return { from: addDays(today, -6), to: today };
  }
}

/** "1h 05m", "12m 30s", "45s", "—" for none. */
export function talkTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

/** "3:07" — one call's length. */
export function callLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
