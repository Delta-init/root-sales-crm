/*
 * Sales TV (the user, 2026-10-20): what the backend's GET /sales-tv and the
 * open GET /public/sales-tv answer (services/salesTvService.ts there), and the
 * small formatting the board needs. The open answer is the same without any
 * email (revenue is shown, the user, 2026-10-20).
 */

export type SalesTvCrmStatus = "ok" | "error" | "outdated" | "loading";

export interface SalesTvPerson {
  id: string;
  name: string;
  team: string;
  closingsMonth: number;
  closingsToday: number;
  callsToday: number;
  connectedToday: number;
  talkSecondsToday: number;
  /** This month's revenue — payments collected, as the CRM's own leaderboard counts it. */
  revenueMonth?: number;
  /** HRMS photo (a signed link, good for a few hours), or null for initials. */
  photoUrl?: string | null;
  email?: string;
}

export interface SalesTvCrm {
  code: string;
  name: string;
  status: SalesTvCrmStatus;
  error: string | null;
  month: string | null;
  peopleUpdatedAt: string | null;
  liveUpdatedAt: string | null;
  people: SalesTvPerson[];
  /** Payments collected today (Dubai day) on its people's leads, AED, the hidden ones' too; null while unknown. */
  revenueToday?: number | null;
  /** People not listed on this screen (the Manager TV hides dilshad, 2026-10-31) — their figures still count in the total. */
  hidden?: { count: number; closingsMonth: number; closingsToday: number; revenueMonth: number; callsToday: number; connectedToday: number; talkSecondsToday: number };
  /** Those people's rows, for the card's "Show …" button (the Manager TV, 2026-11-06). */
  hiddenPeople?: SalesTvPerson[];
  /** Remote's people outside Team Avengers (2026-11-06): a card of their own, opened by the arrow on Team Avengers. */
  split?: { otherIds: string[]; otherName: string };
}

export interface SalesTvBreak {
  id: string;
  name: string;
  team: string;
  since: string;
  kind: string | null;
  crm: string;
  crmName: string;
  photoUrl: string | null;
}

export interface SalesTvClose {
  key: string;
  id: string;
  crm: string;
  crmName: string;
  closer: string;
  courses: string[];
  amount: number;
  academy: "dubai" | "bangalore";
  currency: "AED" | "INR";
  at: string;
  seenAt: string;
  /** The Manager TV's CS payments come in among the closes (crm "cs"), announced as a CS payment. */
  kind?: "sale" | "cs_payment";
}

/* The Manager TV's fourth card (2026-10-23): the CS team as CS Portal's CS leaderboard ranks it — each CS
   by the course payments they collected this month (approved, AED). */
export interface SalesTvCsPerson {
  id: string;
  name: string;
  team: string;
  monthAed: number;
  todayAed: number;
  payments: number;
  todayPayments: number;
  photoUrl: string | null;
}

export interface SalesTvCs {
  code: "cs";
  name: string;
  status: SalesTvCrmStatus;
  error: string | null;
  month: string | null;
  updatedAt: string | null;
  people: SalesTvCsPerson[];
  teams: Array<{ team: string; monthAed: number; todayAed: number; payments: number; csCount: number }>;
  totals: { monthAed: number; todayAed: number; payments: number };
}

export interface SalesTvData {
  serverTime: string;
  crms: SalesTvCrm[];
  onBreak: SalesTvBreak[];
  closes: SalesTvClose[];
  /** Only on the Manager TV. */
  cs?: SalesTvCs;
  /** The Manager TV's month switch (2026-11-01): a month gone by, as it ended — no closes, nothing of today. */
  past?: boolean;
  month?: string;
}

/**
 * Asks for the screen; `since` is the previous answer's serverTime, so only new closes come back; `month` (YYYY-MM,
 * the Manager TV's month switch) a month gone by instead of the live one.
 */
export type SalesTvFetcher = (since: string | null, month?: string | null) => Promise<SalesTvData>;

/** The first month the TVs can show: commission and these boards began in October 2026. */
export const FIRST_TV_MONTH = "2026-10";

/** The months gone by the Manager TV can switch to, newest first — from FIRST_TV_MONTH to last month (Dubai). */
export function pastTvMonths(nowMs = Date.now()): string[] {
  const g = new Date(nowMs + 4 * 3_600_000);
  const out: string[] = [];
  for (let d = new Date(Date.UTC(g.getUTCFullYear(), g.getUTCMonth() - 1, 1)); ; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))) {
    const m = d.toISOString().slice(0, 7);
    if (m < FIRST_TV_MONTH) break;
    out.push(m);
  }
  return out;
}

/** "2026-10" → "October 2026". */
export function monthYearLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export const fmtInt = (n: number) => Math.round(n || 0).toLocaleString("en-US");

/** "AED 5,500", "INR 55,000". */
export const fmtMoney = (amount: number, currency: string) =>
  `${currency} ${(amount || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** "2h 05m", "45m", "0m". */
export function fmtTalk(seconds: number): string {
  const m = Math.floor((seconds || 0) / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** A running clock: "4:07", "1:02:30". */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const BREAK_KINDS: Record<string, string> = { meeting: "Meeting", lunch: "Lunch", tea: "Tea", washroom: "Washroom" };
export const breakLabel = (kind: string | null) => (kind && BREAK_KINDS[kind]) || "Break";

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export function monthLabel(m: string | null): string {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return "This month";
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

/** Each CRM's colour on the board: the stripe on its table and its tag on breaks and closes. */
const CRM_TONE: Record<string, string> = { delta: "#2f6bff", draw: "#9b5cff", remote: "#00b3a4", remote_others: "#00b3a4", cs: "#e85d9a" };
export const crmTone = (crm: string | undefined) => (crm && CRM_TONE[crm]) || "#6b7280";

/** The short tag a CRM goes by on the board — its team's name (2026-11-06): Cartel, Syndicate, Avengers, Mafia. */
const CRM_TAG: Record<string, string> = { delta: "Cartel", draw: "Syndicate", remote: "Avengers", cs: "Mafia" };
export const crmTag = (crm: string, name: string) => CRM_TAG[crm] ?? name;

/** A team's colour stripe, like a team's livery on a timing tower — the same team, the same colour, every time. */
const TEAM_TONES = ["#e8002d", "#27f4d2", "#ff8000", "#3671c6", "#229971", "#ff87bc", "#64c4ff", "#b6babd", "#52e252", "#ffd12e"];
export function teamTone(team: string): string {
  if (!team) return "#3a3f4a";
  let h = 0;
  for (const ch of team.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_TONES[h % TEAM_TONES.length];
}

/** Revenue on the board: the CRMs' figures are dirhams, as their close amounts are. "AED 45,500". */
export const fmtRevenue = (n: number) => fmtMoney(n, "AED");

/**
 * Money rounded for the Manager TV (the user, 2026-11-03: "show 1k instead of the full amount, the full amount on
 * hover"): 950, 1.3K, 42.4K, 256K, 1.25M. The full figure goes in the title beside it.
 */
export function fmtShort(n: number): string {
  const v = Math.round(n || 0);
  const a = Math.abs(v);
  const trim = (s: string) => s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (a < 1000) return v.toLocaleString("en-US");
  if (a < 99_950) return `${trim((v / 1000).toFixed(1))}K`;
  if (a < 999_500) return `${Math.round(v / 1000)}K`;
  return `${trim((v / 1_000_000).toFixed(2))}M`;
}
