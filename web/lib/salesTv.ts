/*
 * Sales TV (the user, 2026-10-20): what the backend's GET /sales-tv and the
 * open GET /public/sales-tv answer (services/salesTvService.ts there), and the
 * small formatting the board needs. The open answer is the same without any
 * email or revenue figure.
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
  /** HRMS photo (a signed link, good for a few hours), or null for initials. */
  photoUrl?: string | null;
  email?: string;
  revenueMonth?: number;
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
}

export interface SalesTvData {
  serverTime: string;
  crms: SalesTvCrm[];
  onBreak: SalesTvBreak[];
  closes: SalesTvClose[];
}

/** Asks for the screen; `since` is the previous answer's serverTime, so only new closes come back. */
export type SalesTvFetcher = (since: string | null) => Promise<SalesTvData>;

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
const CRM_TONE: Record<string, string> = { delta: "#2f6bff", draw: "#9b5cff", remote: "#00b3a4" };
export const crmTone = (crm: string | undefined) => (crm && CRM_TONE[crm]) || "#6b7280";

/** The short tag a CRM goes by on the board: "SALES", "DRAW", "REMOTE". */
const CRM_TAG: Record<string, string> = { delta: "Sales", draw: "Draw", remote: "Remote" };
export const crmTag = (crm: string, name: string) => CRM_TAG[crm] ?? name;

/** A team's colour stripe, like a team's livery on a timing tower — the same team, the same colour, every time. */
const TEAM_TONES = ["#e8002d", "#27f4d2", "#ff8000", "#3671c6", "#229971", "#ff87bc", "#64c4ff", "#b6babd", "#52e252", "#ffd12e"];
export function teamTone(team: string): string {
  if (!team) return "#3a3f4a";
  let h = 0;
  for (const ch of team.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_TONES[h % TEAM_TONES.length];
}
