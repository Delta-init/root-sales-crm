"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { AlertTriangle, Maximize, Minimize, Trophy, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  breakLabel, crmTag, crmTone, fmtClock, fmtInt, fmtMoney, fmtRevenue, fmtTalk, initials, monthLabel,
  type SalesTvBreak, type SalesTvClose, type SalesTvCrm, type SalesTvCs, type SalesTvCsPerson, type SalesTvFetcher, type SalesTvPerson,
} from "@/lib/salesTv";
import { setSoundPref, soundUnlocked, unlockSound, useSoundPref, useSoundUnlocked, type SaleClosed } from "@/lib/saleAnnouncement";
import { SaleCelebration, celebrate } from "./SaleCelebration";
import { boardFont } from "./font";

/*
 * The Sales TV board (the user, 2026-10-20): the Dubai Sales CRM, Draw and
 * Remote side by side — closings this month and today, revenue this month,
 * calls today (connected of total) and talk time — who is on a break now
 * (HRMS photo, live timer), and every close celebrated with the amount, a
 * sparkle and a voice.
 *
 * Each CRM opens with a podium (the user's reference, 2026-10-20): the top
 * three on 3D steps with their HRMS photos and a gold, silver or bronze
 * trophy, then the standings from 4th down. A warm dark-brown theme with an
 * orange accent, in solid colours — the steps' depth is two flat faces, no
 * gradients.
 *
 * Shared by the signed-in page (/sales-tv, variant "embedded") and the open
 * TV link (/public/sales-tv, variant "tv"). It polls Root every few seconds;
 * Root's cache decides how often the CRMs are actually asked. Each close is
 * announced once per screen, and only closes that arrive after the screen
 * opened — opening it never replays the afternoon.
 *
 * The Manager TV (the user, 2026-10-23: "same as the Sales TV, only a new card for the CS, exactly like the CS
 * leaderboard") is this board with `withCs`: a fourth card, the CS team ranked by the course payments they
 * collected this month, and each approved CS payment announced like a sale — without the On break and Latest
 * closes cards (`panels={false}`, 2026-10-23), the four cards across the whole screen; the pop-ups stay.
 */

const POLL_MS = 5000;
const KEEP_CLOSES_MS = 2 * 3_600_000;
/** A close that happened this long before the screen opened is never announced. */
const OPEN_SLACK_MS = 60_000;
const LONG_BREAK_MS = 30 * 60_000;

/** Solid colours only. */
const CSS = `
.stv{--bg:#0f0a07;--panel:#160e09;--panel2:#1d130c;--head:#24180f;--line:#2f2117;--ink:#f8f1ea;--ink2:#dccbbd;--mute:#9d8776;
--accent:#ff6b1a;--good:#5ad17f;--warn:#f5a524;--bad:#ff5a4f;--money:#ffc861;
--gold:#ecd27c;--gold-on:#6b4d00;--silver:#dfe2e6;--silver-on:#4a5361;--bronze:#e0a96d;--bronze-on:#5c3410;
--step-top:#3a271a;--step-front:#25190f;--step-edge:#4b3324;
background:var(--bg);color:var(--ink)}
body:has(.stv-tv){background:#0f0a07}
.stv .num{font-variant-numeric:tabular-nums lining-nums}
@keyframes stv-blink{0%,55%{opacity:1}56%,100%{opacity:.3}}
.stv-blink{animation:stv-blink 1.2s steps(1,end) infinite}
@media (prefers-reduced-motion:reduce){.stv-blink{animation:none}}
.stv-scroll{scrollbar-width:none}.stv-scroll::-webkit-scrollbar{display:none}
`;

const PLACES = ["gold", "silver", "bronze"] as const;
type Place = (typeof PLACES)[number];

const dubaiTime = (at: number) => new Date(at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dubaiHm = (at: number) => new Date(at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" });
const dubaiDate = (at: number) => new Date(at).toLocaleDateString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short", year: "numeric" });
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

const toSale = (c: SalesTvClose): SaleClosed => ({
  id: c.key, closer: c.closer, courses: c.courses, amount: c.amount, currency: c.currency, crmName: c.crmName, crm: c.crm, at: c.at, kind: c.kind,
});

/** Type sizes that grow with the screen: a laptop and a 65-inch TV both read well. */
const T = {
  tiny: "text-[clamp(0.62rem,0.66vw,0.92rem)]",
  small: "text-[clamp(0.72rem,0.78vw,1.08rem)]",
  body: "text-[clamp(0.9rem,1vw,1.45rem)]",
  title: "text-[clamp(1.05rem,1.25vw,1.8rem)]",
};

export interface SalesTvBoardProps {
  fetcher: SalesTvFetcher;
  /** "tv": the whole screen, rows scroll themselves; "embedded": inside the signed-in page. */
  variant: "tv" | "embedded";
  /** The Manager TV: the CS team as a fourth card (the answer's `cs`). */
  withCs?: boolean;
  /** The On break and Latest closes cards (the Manager TV has none). */
  panels?: boolean;
  title?: string;
  subtitle?: string;
}

export function SalesTvBoard({ fetcher, variant, withCs = false, panels = true, title = "Sales TV", subtitle = "Dubai Sales · Draw · Remote" }: SalesTvBoardProps) {
  const tv = variant === "tv";
  const [crms, setCrms] = useState<SalesTvCrm[] | null>(null);
  const [cs, setCs] = useState<SalesTvCs | null>(null);
  const [onBreak, setOnBreak] = useState<SalesTvBreak[]>([]);
  const [closes, setCloses] = useState<SalesTvClose[]>([]);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const since = useRef<string | null>(null);
  const openedAt = useRef<number | null>(null);
  const seen = useRef(new Set<string>());
  const root = useRef<HTMLDivElement>(null);

  // One second at a time, for the clock, the break timers and "updated Xs ago".
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const d = await fetcher(since.current);
        const serverNow = Date.parse(d.serverTime);
        offset.current = serverNow - Date.now();
        const first = openedAt.current === null;
        if (first) openedAt.current = serverNow;
        const fresh = d.closes.filter((c) => !seen.current.has(c.key));
        for (const c of fresh) seen.current.add(c.key);
        if (!first) {
          const from = (openedAt.current ?? serverNow) - OPEN_SLACK_MS;
          fresh.filter((c) => Date.parse(c.at) >= from).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach((c) => celebrate(toSale(c)));
        }
        setCloses((prev) => {
          const byKey = new Map(prev.map((c) => [c.key, c]));
          for (const c of d.closes) byKey.set(c.key, c);
          return Array.from(byKey.values()).filter((c) => serverNow - Date.parse(c.at) <= KEEP_CLOSES_MS).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        });
        since.current = d.serverTime;
        setCrms(d.crms);
        if (d.cs) setCs(d.cs);
        setOnBreak(d.onBreak);
        setLastOk(Date.now());
        setFetchError(null);
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "Can't reach Root");
      }
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [fetcher]);

  const serverNow = now + offset.current;
  const gap = "gap-[clamp(0.5rem,0.7vw,1.1rem)]";

  return (
    <div ref={root} className={cn("stv relative", boardFont.className, tv ? "stv-tv flex h-[100dvh] flex-col overflow-hidden p-[clamp(0.5rem,0.7vw,1.1rem)]" : "rounded-2xl p-3 sm:p-4")}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Header tv={tv} serverNow={serverNow} lastOk={lastOk} now={now} fetchError={fetchError} rootRef={root} title={title} subtitle={subtitle} />

      <div
        className={cn(
          "mt-[clamp(0.5rem,0.7vw,1.1rem)] grid", gap,
          tv
            ? cn("min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto lg:auto-rows-[minmax(0,1fr)] lg:overflow-hidden",
              withCs
                ? panels ? "lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(14rem,0.5fr)]" : "lg:grid-cols-4"
                : panels ? "lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(15rem,0.62fr)]" : "lg:grid-cols-3")
            : withCs ? "grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4" : "grid-cols-1 lg:grid-cols-3",
        )}
      >
        {(crms ?? PLACEHOLDER).map((crm) => (
          <CrmColumn key={crm.code} crm={crm} tv={tv} />
        ))}
        {withCs && <CsColumn cs={cs ?? CS_PLACEHOLDER} tv={tv} />}
        {panels && (
          <aside className={cn("flex min-h-0 flex-col", gap, !tv && (withCs ? "lg:col-span-2 2xl:col-span-4 lg:grid lg:grid-cols-2" : "lg:col-span-3 lg:grid lg:grid-cols-2"))}>
            <BreakPanel people={onBreak} serverNow={serverNow} tv={tv} />
            <RecentCloses closes={closes} tv={tv} />
          </aside>
        )}
      </div>

      <SoundPrompt tv={tv} />
      <SaleCelebration />
    </div>
  );
}

const PLACEHOLDER: SalesTvCrm[] = [
  { code: "delta", name: "Dubai Sales", status: "loading", error: null, month: null, peopleUpdatedAt: null, liveUpdatedAt: null, people: [] },
  { code: "draw", name: "Draw", status: "loading", error: null, month: null, peopleUpdatedAt: null, liveUpdatedAt: null, people: [] },
  { code: "remote", name: "Remote", status: "loading", error: null, month: null, peopleUpdatedAt: null, liveUpdatedAt: null, people: [] },
];

const CS_PLACEHOLDER: SalesTvCs = {
  code: "cs", name: "CS team", status: "loading", error: null, month: null, updatedAt: null, people: [], teams: [], totals: { monthAed: 0, todayAed: 0, payments: 0 },
};

// ── Header ─────────────────────────────────────────────────────────────────────

function Header({ tv, serverNow, lastOk, now, fetchError, rootRef, title, subtitle }: {
  tv: boolean; serverNow: number; lastOk: number | null; now: number; fetchError: string | null; rootRef: RefObject<HTMLDivElement>;
  title: string; subtitle: string;
}) {
  const pref = useSoundPref();
  const soundOn = pref !== "off";
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const stale = !lastOk || now - lastOk > 20_000;
  const down = Boolean(fetchError) || stale;
  const btn = cn("inline-flex h-[clamp(1.9rem,2vw,2.6rem)] items-center gap-1.5 rounded-full border border-[color:var(--line)] px-3.5 font-medium text-[color:var(--ink2)] hover:border-[color:var(--step-edge)] hover:text-[color:var(--ink)]", T.small);

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-3">
        <span className="grid h-[clamp(2.1rem,2.3vw,3.1rem)] w-[clamp(2.1rem,2.3vw,3.1rem)] place-items-center rounded-xl bg-[color:var(--accent)] text-white">
          <Trophy className="h-[55%] w-[55%]" />
        </span>
        <div className="leading-tight">
          <h1 className={cn("font-bold tracking-tight", T.title)}>{title}</h1>
          <p className={cn("text-[color:var(--mute)]", T.small)}>{subtitle}</p>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
        <span
          className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium", T.small,
            down ? "border-[color:var(--warn)] text-[color:var(--warn)]" : "border-[color:var(--line)] text-[color:var(--ink2)]")}
          title={fetchError ?? undefined}
          data-testid="live-status"
        >
          <span className={cn("inline-block h-2 w-2 rounded-full", down ? "bg-[color:var(--warn)]" : "stv-blink bg-[color:var(--accent)]")} />
          {!lastOk ? (fetchError ? "Can't reach Root — retrying" : "Connecting…")
            : down ? `Reconnecting · last update ${ago(now - lastOk)}`
            : `Live · ${ago(now - lastOk)}`}
        </span>
        <span className={cn("hidden text-[color:var(--mute)] md:inline", T.small)} suppressHydrationWarning>{dubaiDate(serverNow)}</span>
        <span className={cn("num hidden min-w-[5.5ch] font-semibold sm:inline", T.title)} suppressHydrationWarning>{dubaiTime(serverNow)}</span>
        <button
          type="button"
          onClick={() => celebrate({ id: `test-${Date.now()}`, closer: "Test", courses: ["Sample course"], amount: 5500, currency: "AED", crmName: title, at: new Date().toISOString(), test: true })}
          className={btn}
          title="Show a test celebration on this screen"
        >
          Test
        </button>
        <button
          type="button"
          onClick={() => {
            if (soundOn) setSoundPref("off");
            else { unlockSound(); setSoundPref("on"); }
          }}
          className={btn}
          aria-pressed={!soundOn}
          data-testid="mute-toggle"
        >
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          {soundOn ? "Sound on" : "Muted"}
        </button>
        {tv && (
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
              else void (rootRef.current ?? document.documentElement).requestFullscreen?.().catch(() => undefined);
            }}
            className={btn}
            aria-label={full ? "Leave full screen" : "Full screen"}
          >
            {full ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        )}
      </div>
    </header>
  );
}

// ── A CRM: the podium, then the standings ──────────────────────────────────────

/*
 * #, salesperson, closings this month and today, revenue this month, calls today; talk time too where the screen is
 * wide enough (a TV) — on a laptop the names need the room.
 */
const COLS = "grid grid-cols-[clamp(1.7rem,1.9vw,2.9rem)_minmax(0,1fr)_repeat(2,minmax(0,clamp(1.7rem,1.9vw,2.9rem)))_minmax(0,clamp(3.6rem,4vw,6rem))_minmax(0,clamp(3.2rem,3.5vw,5.2rem))] min-[1500px]:grid-cols-[clamp(1.7rem,1.9vw,2.9rem)_minmax(0,1fr)_repeat(2,minmax(0,clamp(1.7rem,1.9vw,2.9rem)))_minmax(0,clamp(3.6rem,4vw,6rem))_minmax(0,clamp(3.2rem,3.5vw,5.2rem))_minmax(0,clamp(3.4rem,3.6vw,5.4rem))] items-center whitespace-nowrap gap-x-[clamp(0.15rem,0.25vw,0.45rem)]";
/** The talk-time column: only where it fits. */
const WIDE = "hidden min-[1500px]:block";

/** The most connected calls and talk time today in this CRM (0 when nobody has any yet). */
function bests(people: SalesTvPerson[]) {
  return people.reduce(
    (b, p) => ({ conn: Math.max(b.conn, p.connectedToday), talk: Math.max(b.talk, p.talkSecondsToday) }),
    { conn: 0, talk: 0 },
  );
}

function CrmColumn({ crm, tv }: { crm: SalesTvCrm; tv: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const rest = crm.people.slice(3);
  useAutoScroll(body, tv, rest.length);
  const t = crm.people.reduce(
    (a, p) => ({ m: a.m + p.closingsMonth, d: a.d + p.closingsToday, r: a.r + (p.revenueMonth ?? 0), c: a.c + p.callsToday, k: a.k + p.connectedToday, s: a.s + p.talkSecondsToday }),
    { m: 0, d: 0, r: 0, c: 0, k: 0, s: 0 },
  );
  const best = bests(crm.people);
  const head = cn("text-right font-medium text-[color:var(--ink2)]", T.tiny);

  return (
    <section
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-[clamp(1rem,1.2vw,1.6rem)] border border-[color:var(--line)] bg-[color:var(--panel)]", !tv && "max-h-[85vh]")}
      data-testid={`crm-${crm.code}`}
    >
      <div className="flex items-center gap-2.5 px-[clamp(0.8rem,1vw,1.4rem)] pt-[clamp(0.6rem,0.8vw,1.1rem)]">
        <span className="h-[0.7em] w-[0.7em] shrink-0 rounded-full" style={{ background: crmTone(crm.code) }} />
        <h2 className={cn("truncate font-semibold", T.title)}>{crm.name}</h2>
        <span className={cn("ml-auto shrink-0 rounded-full border border-[color:var(--line)] px-3 py-0.5 text-[color:var(--mute)]", T.small)}>
          {monthLabel(crm.month)}
        </span>
      </div>

      {crm.error && (
        <p className={cn("mx-[clamp(0.8rem,1vw,1.4rem)] mt-2 flex items-start gap-1.5 rounded-lg border border-[color:var(--warn)] px-2.5 py-1.5 text-[color:var(--warn)]", T.small)} data-testid={`crm-error-${crm.code}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {crm.error}
        </p>
      )}

      {crm.people.length === 0 ? (
        <p className={cn("px-3 py-10 text-center text-[color:var(--mute)]", T.small)}>
          {crm.status === "loading" ? "Loading…" : crm.error ? "No figures to show." : "No salespeople yet."}
        </p>
      ) : (
        <>
          <Podium people={crm.people.slice(0, 3)} code={crm.code} />

          <div className={cn(COLS, "mx-[clamp(0.4rem,0.5vw,0.8rem)] rounded-full bg-[color:var(--head)] px-[clamp(0.6rem,0.7vw,1rem)] py-[clamp(0.35rem,0.45vw,0.65rem)]")}>
            <span className={cn(head, "text-left")}>#</span>
            <span className={cn(head, "text-left")}>Salesperson</span>
            <span className={head} title="Closings this month">Month</span>
            <span className={head} title="Closings today">Today</span>
            <span className={head} title="Revenue this month (AED) — payments collected">Revenue</span>
            <span className={head} title="Calls today: connected / total">Calls</span>
            <span className={cn(head, WIDE)} title="Talk time today">Talk</span>
          </div>

          <div ref={body} className="stv-scroll min-h-0 flex-1 overflow-y-auto px-[clamp(0.4rem,0.5vw,0.8rem)]">
            {rest.length === 0 ? (
              <p className={cn("px-2 py-4 text-center text-[color:var(--mute)]", T.small)}>Everybody is on the podium.</p>
            ) : (
              <ol>
                {rest.map((p, i) => <PersonRow key={p.id || `${p.name}-${i}`} p={p} rank={i + 4} best={best} />)}
              </ol>
            )}
          </div>

          <div className={cn(COLS, "num border-t border-[color:var(--line)] px-[clamp(1rem,1.2vw,1.8rem)] py-[clamp(0.4rem,0.55vw,0.8rem)] font-semibold whitespace-nowrap", T.body)} data-testid={`totals-${crm.code}`}>
            <span className={cn("col-span-2 truncate font-medium text-[color:var(--mute)]", T.small)}>Total · {crm.people.length} people</span>
            <Num>{fmtInt(t.m)}</Num>
            <Num>{fmtInt(t.d)}</Num>
            <Num className="text-[color:var(--money)]" title={fmtRevenue(t.r)}>{fmtInt(t.r)}</Num>
            <Num>{fmtInt(t.k)}<span className="text-[color:var(--mute)]">/{fmtInt(t.c)}</span></Num>
            <Num className={WIDE}>{fmtTalk(t.s)}</Num>
          </div>
        </>
      )}
    </section>
  );
}

// ── The CS team: the Manager TV's fourth card ─────────────────────────────────

/*
 * As CS Portal's CS leaderboard ranks them: the course payments each CS collected this month (approved by
 * finance, AED), today's, and how many. #, CS, month, today, payments.
 */
const CS_COLS = "grid grid-cols-[clamp(1.7rem,1.9vw,2.9rem)_minmax(0,1fr)_minmax(0,clamp(3.6rem,4.2vw,6.2rem))_minmax(0,clamp(3rem,3.4vw,5rem))_minmax(0,clamp(1.9rem,2.1vw,3.1rem))] items-center whitespace-nowrap gap-x-[clamp(0.15rem,0.25vw,0.45rem)]";

function CsColumn({ cs, tv }: { cs: SalesTvCs; tv: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const rest = cs.people.slice(3);
  useAutoScroll(body, tv, rest.length);
  const head = cn("text-right font-medium text-[color:var(--ink2)]", T.tiny);
  const zero = "text-[color:var(--mute)]";
  return (
    <section
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-[clamp(1rem,1.2vw,1.6rem)] border border-[color:var(--line)] bg-[color:var(--panel)]", !tv && "max-h-[85vh]")}
      data-testid="crm-cs"
    >
      <div className="flex items-center gap-2.5 px-[clamp(0.8rem,1vw,1.4rem)] pt-[clamp(0.6rem,0.8vw,1.1rem)]">
        <span className="h-[0.7em] w-[0.7em] shrink-0 rounded-full" style={{ background: crmTone("cs") }} />
        <h2 className={cn("truncate font-semibold", T.title)}>{cs.name}</h2>
        <span className={cn("ml-auto shrink-0 rounded-full border border-[color:var(--line)] px-3 py-0.5 text-[color:var(--mute)]", T.small)}>
          {monthLabel(cs.month)}
        </span>
      </div>

      {cs.error && (
        <p className={cn("mx-[clamp(0.8rem,1vw,1.4rem)] mt-2 flex items-start gap-1.5 rounded-lg border border-[color:var(--warn)] px-2.5 py-1.5 text-[color:var(--warn)]", T.small)} data-testid="crm-error-cs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {cs.error}
        </p>
      )}

      {cs.people.length === 0 ? (
        <p className={cn("px-3 py-10 text-center text-[color:var(--mute)]", T.small)}>
          {cs.status === "loading" ? "Loading…" : cs.error ? "No figures to show." : "No CSs yet."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 items-end gap-[clamp(0.25rem,0.35vw,0.6rem)] px-[clamp(0.6rem,0.8vw,1.2rem)] pb-[clamp(0.5rem,0.7vw,1rem)] pt-[clamp(0.4rem,0.6vw,0.9rem)]" data-testid="podium-cs">
            {[1, 0, 2].map((i) => {
              const p = cs.people[i];
              return p ? <CsStep key={p.id || p.name} p={p} rank={i + 1} /> : <span key={`empty-${i}`} />;
            })}
          </div>

          <div className={cn(CS_COLS, "mx-[clamp(0.4rem,0.5vw,0.8rem)] rounded-full bg-[color:var(--head)] px-[clamp(0.6rem,0.7vw,1rem)] py-[clamp(0.35rem,0.45vw,0.65rem)]")}>
            <span className={cn(head, "text-left")}>#</span>
            <span className={cn(head, "text-left")}>CS</span>
            <span className={head} title="Course payments collected this month (AED, approved)">Month</span>
            <span className={head} title="Collected today (AED)">Today</span>
            <span className={head} title="Payments this month">Pays</span>
          </div>

          <div ref={body} className="stv-scroll min-h-0 flex-1 overflow-y-auto px-[clamp(0.4rem,0.5vw,0.8rem)]">
            {rest.length === 0 ? (
              <p className={cn("px-2 py-4 text-center text-[color:var(--mute)]", T.small)}>Everybody is on the podium.</p>
            ) : (
              <ol>
                {rest.map((p, i) => (
                  <li key={p.id || `${p.name}-${i}`} className={cn(CS_COLS, "num border-b border-[color:var(--line)] px-[clamp(0.6rem,0.7vw,1rem)] py-[clamp(0.3rem,0.4vw,0.6rem)] last:border-b-0", T.body)}>
                    <span className={cn("font-medium text-[color:var(--mute)]", T.tiny)}>#{String(i + 4).padStart(2, "0")}</span>
                    <span className="flex min-w-0 items-center gap-[clamp(0.4rem,0.5vw,0.75rem)]">
                      <Photo name={p.name} url={p.photoUrl} className="hidden h-[clamp(1.7rem,1.9vw,2.7rem)] w-[clamp(1.7rem,1.9vw,2.7rem)] rounded-full min-[1500px]:grid" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium leading-tight">{p.name}</span>
                        <span className={cn("block truncate leading-tight text-[color:var(--mute)]", T.tiny)}>{p.team || "—"}</span>
                      </span>
                    </span>
                    <Num className={p.monthAed ? "font-semibold text-[color:var(--money)]" : zero} title={fmtRevenue(p.monthAed)}>{fmtInt(p.monthAed)}</Num>
                    <Num className={p.todayAed ? "font-semibold text-[color:var(--good)]" : zero} title={fmtRevenue(p.todayAed)}>{fmtInt(p.todayAed)}</Num>
                    <Num className={p.payments ? undefined : zero}>{fmtInt(p.payments)}</Num>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className={cn(CS_COLS, "num border-t border-[color:var(--line)] px-[clamp(1rem,1.2vw,1.8rem)] py-[clamp(0.4rem,0.55vw,0.8rem)] font-semibold whitespace-nowrap", T.body)} data-testid="totals-cs">
            <span className={cn("col-span-2 truncate font-medium text-[color:var(--mute)]", T.small)}>Total · {cs.people.length} CSs</span>
            <Num className="text-[color:var(--money)]" title={fmtRevenue(cs.totals.monthAed)}>{fmtInt(cs.totals.monthAed)}</Num>
            <Num title={fmtRevenue(cs.totals.todayAed)}>{fmtInt(cs.totals.todayAed)}</Num>
            <Num>{fmtInt(cs.totals.payments)}</Num>
          </div>
        </>
      )}
    </section>
  );
}

function CsStep({ p, rank }: { p: SalesTvCsPerson; rank: number }) {
  const first = rank === 1;
  // A coloured trophy only with something collected.
  const place: Place | undefined = p.monthAed > 0 ? PLACES[rank - 1] : undefined;
  return (
    <div className="flex min-w-0 flex-col items-center">
      <Photo
        name={p.name}
        url={p.photoUrl}
        className={cn(first ? "h-[clamp(3.4rem,3.9vw,5.6rem)] w-[clamp(3.4rem,3.9vw,5.6rem)]" : "h-[clamp(2.8rem,3.1vw,4.5rem)] w-[clamp(2.8rem,3.1vw,4.5rem)]", "rounded-[24%]")}
        ring={place ? `var(--${place})` : "var(--step-edge)"}
      />
      <p className={cn("mt-1.5 w-full truncate text-center font-semibold leading-tight", first ? T.title : T.body)} title={p.name}>{p.name}</p>
      <p className={cn("w-full truncate text-center text-[color:var(--mute)]", T.tiny)}>{p.team || "—"}</p>
      <div className="mt-[clamp(0.3rem,0.45vw,0.7rem)] w-full">
        <div className="h-[clamp(0.7rem,0.85vw,1.2rem)] w-full bg-[color:var(--step-top)]" style={{ clipPath: "polygon(9% 0, 91% 0, 100% 100%, 0 100%)" }} />
        <div
          className={cn("flex w-full flex-col items-center border-t border-[color:var(--step-edge)] bg-[color:var(--step-front)] px-1",
            first ? "pb-[clamp(0.9rem,1.3vw,1.9rem)] pt-[clamp(0.45rem,0.6vw,0.9rem)]" : "pb-[clamp(0.4rem,0.55vw,0.8rem)] pt-[clamp(0.35rem,0.5vw,0.75rem)]")}
        >
          <span
            className="grid h-[clamp(1.6rem,1.8vw,2.6rem)] w-[clamp(1.6rem,1.8vw,2.6rem)] place-items-center rounded-[28%]"
            style={place ? { background: `var(--${place})`, color: `var(--${place}-on)` } : { background: "var(--step-top)", color: "var(--mute)" }}
            title={`${rank}${rank === 1 ? "st" : rank === 2 ? "nd" : "rd"}`}
          >
            <Trophy className="h-[55%] w-[55%]" />
          </span>
          <p className={cn("num mt-1 whitespace-nowrap font-bold leading-none text-[color:var(--money)]", first ? "text-[clamp(1.15rem,1.45vw,2.1rem)]" : "text-[clamp(0.95rem,1.15vw,1.7rem)]")} title="Collected this month">
            {fmtRevenue(p.monthAed)}
          </p>
          <p className={cn("text-[color:var(--mute)]", T.tiny)}>collected</p>
          <div className="my-[clamp(0.25rem,0.35vw,0.5rem)] h-px w-4/5 bg-[color:var(--line)]" />
          <p className={cn("num whitespace-nowrap text-[color:var(--ink2)]", T.tiny)}>
            <span className={p.todayAed > 0 ? "font-semibold text-[color:var(--good)]" : undefined}>{fmtInt(p.todayAed)} today</span>
            {" · "}{fmtInt(p.payments)} {p.payments === 1 ? "payment" : "payments"}
          </p>
        </div>
      </div>
    </div>
  );
}

function Num({ children, className, style, title }: { children: ReactNode; className?: string; style?: CSSProperties; title?: string }) {
  return <span className={cn("text-right", className)} style={style} title={title}>{children}</span>;
}

// ── The podium: 2nd, 1st, 3rd on steps ─────────────────────────────────────────

function Podium({ people, code }: { people: SalesTvPerson[]; code: string }) {
  // Left to right: second, first, third — the first standing tallest in the middle.
  const order = [1, 0, 2];
  return (
    <div className="grid grid-cols-3 items-end gap-[clamp(0.25rem,0.35vw,0.6rem)] px-[clamp(0.6rem,0.8vw,1.2rem)] pb-[clamp(0.5rem,0.7vw,1rem)] pt-[clamp(0.4rem,0.6vw,0.9rem)]" data-testid={`podium-${code}`}>
      {order.map((i) => {
        const p = people[i];
        return p ? <Step key={p.id || p.name} p={p} rank={i + 1} /> : <span key={`empty-${i}`} />;
      })}
    </div>
  );
}

function Step({ p, rank }: { p: SalesTvPerson; rank: number }) {
  const first = rank === 1;
  // A coloured trophy only with something to show for it: nobody wins gold for no closings.
  const place: Place | undefined = p.closingsMonth > 0 ? PLACES[rank - 1] : undefined;
  return (
    <div className="flex min-w-0 flex-col items-center">
      <Photo
        name={p.name}
        url={p.photoUrl ?? null}
        className={cn(first ? "h-[clamp(3.4rem,3.9vw,5.6rem)] w-[clamp(3.4rem,3.9vw,5.6rem)]" : "h-[clamp(2.8rem,3.1vw,4.5rem)] w-[clamp(2.8rem,3.1vw,4.5rem)]", "rounded-[24%]")}
        ring={place ? `var(--${place})` : "var(--step-edge)"}
      />
      <p className={cn("mt-1.5 w-full truncate text-center font-semibold leading-tight", first ? T.title : T.body)} title={p.name}>{p.name}</p>
      <p className={cn("w-full truncate text-center text-[color:var(--mute)]", T.tiny)}>{p.team || "—"}</p>

      <div className="mt-[clamp(0.3rem,0.45vw,0.7rem)] w-full">
        {/* The step's top, seen from above: a flat trapezoid in a lighter brown. */}
        <div className="h-[clamp(0.7rem,0.85vw,1.2rem)] w-full bg-[color:var(--step-top)]" style={{ clipPath: "polygon(9% 0, 91% 0, 100% 100%, 0 100%)" }} />
        {/* …and its front, darker. */}
        <div
          className={cn("flex w-full flex-col items-center border-t border-[color:var(--step-edge)] bg-[color:var(--step-front)] px-1",
            first ? "pb-[clamp(0.9rem,1.3vw,1.9rem)] pt-[clamp(0.45rem,0.6vw,0.9rem)]" : "pb-[clamp(0.4rem,0.55vw,0.8rem)] pt-[clamp(0.35rem,0.5vw,0.75rem)]")}
        >
          <span
            className="grid h-[clamp(1.6rem,1.8vw,2.6rem)] w-[clamp(1.6rem,1.8vw,2.6rem)] place-items-center rounded-[28%]"
            style={place ? { background: `var(--${place})`, color: `var(--${place}-on)` } : { background: "var(--step-top)", color: "var(--mute)" }}
            title={`${rank}${rank === 1 ? "st" : rank === 2 ? "nd" : "rd"}`}
          >
            <Trophy className="h-[55%] w-[55%]" />
          </span>
          <p className={cn("num mt-1 font-bold leading-none", first ? "text-[clamp(1.6rem,2vw,2.9rem)]" : "text-[clamp(1.3rem,1.55vw,2.25rem)]")}>{fmtInt(p.closingsMonth)}</p>
          <p className={cn("text-[color:var(--mute)]", T.tiny)}>closings</p>
          <p className={cn("num mt-[clamp(0.2rem,0.3vw,0.45rem)] whitespace-nowrap font-bold text-[color:var(--money)]", first ? T.body : T.small)} title="Revenue this month">
            {fmtRevenue(p.revenueMonth ?? 0)}
          </p>
          <div className="my-[clamp(0.25rem,0.35vw,0.5rem)] h-px w-4/5 bg-[color:var(--line)]" />
          <p className={cn("num whitespace-nowrap text-[color:var(--ink2)]", T.tiny)}>
            <span className={p.closingsToday > 0 ? "font-semibold text-[color:var(--good)]" : undefined}>{fmtInt(p.closingsToday)} today</span>
            {" · "}{fmtInt(p.connectedToday)}/{fmtInt(p.callsToday)} calls
          </p>
        </div>
      </div>
    </div>
  );
}

function PersonRow({ p, rank, best }: { p: SalesTvPerson; rank: number; best: ReturnType<typeof bests> }) {
  const hot = (v: number, b: number) => (v > 0 && v === b ? { color: "var(--accent)" } : undefined);
  const zero = "text-[color:var(--mute)]";
  return (
    <li className={cn(COLS, "num border-b border-[color:var(--line)] px-[clamp(0.6rem,0.7vw,1rem)] py-[clamp(0.3rem,0.4vw,0.6rem)] last:border-b-0", T.body)}>
      <span className={cn("font-medium text-[color:var(--mute)]", T.tiny)}>#{String(rank).padStart(2, "0")}</span>
      <span className="flex min-w-0 items-center gap-[clamp(0.4rem,0.5vw,0.75rem)]">
        {/* A small photo where the column has room for it (a TV); on a laptop the name matters more. */}
        <Photo name={p.name} url={p.photoUrl ?? null} className="hidden h-[clamp(1.7rem,1.9vw,2.7rem)] w-[clamp(1.7rem,1.9vw,2.7rem)] rounded-full min-[1500px]:grid" />
        <span className="min-w-0">
          <span className="block truncate font-medium leading-tight">{p.name}</span>
          <span className={cn("block truncate leading-tight text-[color:var(--mute)]", T.tiny)}>{p.team || "—"}</span>
        </span>
      </span>
      <Num className="font-semibold">{fmtInt(p.closingsMonth)}</Num>
      <Num className={p.closingsToday > 0 ? "font-semibold text-[color:var(--good)]" : zero}>{fmtInt(p.closingsToday)}</Num>
      <Num className={p.revenueMonth ? "font-semibold text-[color:var(--money)]" : zero} title={fmtRevenue(p.revenueMonth ?? 0)}>{fmtInt(p.revenueMonth ?? 0)}</Num>
      <Num title="Connected / total — orange: the most today in this CRM">
        <span style={hot(p.connectedToday, best.conn)} className={p.connectedToday ? undefined : zero}>{fmtInt(p.connectedToday)}</span>
        <span className={zero}>/{fmtInt(p.callsToday)}</span>
      </Num>
      <Num className={cn(p.talkSecondsToday ? "text-[color:var(--ink2)]" : zero, WIDE)} style={hot(p.talkSecondsToday, best.talk)}>{fmtTalk(p.talkSecondsToday)}</Num>
    </li>
  );
}

/** On a TV nobody scrolls: a table longer than its box drifts down, rests, and goes back up. */
function useAutoScroll(ref: RefObject<HTMLDivElement>, on: boolean, rows: number) {
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    let raf = 0;
    let pauseUntil = performance.now() + 4000;
    let goTop = false;
    let pos = el.scrollTop;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 4 || t < pauseUntil) return;
      if (goTop) {
        goTop = false;
        el.scrollTo({ top: 0, behavior: "smooth" });
        pos = 0;
        pauseUntil = t + 5000;
        return;
      }
      pos = Math.min(max, pos + 0.45);
      el.scrollTop = pos;
      if (pos >= max) {
        goTop = true;
        pauseUntil = t + 4000;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ref, on, rows]);
}

/** The HRMS photo; initials on a warm tile when there is none or it won't load. */
function Photo({ name, url, className, ring }: { name: string; url: string | null; className: string; ring?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const style = ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined;
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className={cn("shrink-0 object-cover", className)} style={style} onError={() => setFailed(true)} referrerPolicy="no-referrer" />;
  }
  return (
    <span className={cn("grid shrink-0 place-items-center bg-[color:var(--step-top)] font-semibold text-[color:var(--ink2)]", className)} style={style}>
      {initials(name)}
    </span>
  );
}

// ── Side panels ────────────────────────────────────────────────────────────────

function Panel({ title, dot, count, hint, className, testId, children }: {
  title: string; dot: string; count?: number; hint?: string; className?: string; testId: string; children: ReactNode;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-[clamp(1rem,1.2vw,1.6rem)] border border-[color:var(--line)] bg-[color:var(--panel)]", className)} data-testid={testId}>
      <div className="flex items-center gap-2.5 px-[clamp(0.8rem,1vw,1.4rem)] py-[clamp(0.6rem,0.8vw,1.1rem)]" title={hint}>
        <span className="h-[0.7em] w-[0.7em] shrink-0 rounded-full" style={{ background: dot }} />
        <h2 className={cn("truncate font-semibold", T.title)}>{title}</h2>
        {count !== undefined && (
          <span className={cn("num ml-auto rounded-full bg-[color:var(--head)] px-3 py-0.5 font-semibold", T.body)}>{count}</span>
        )}
      </div>
      <div className="stv-scroll min-h-0 flex-1 overflow-y-auto px-[clamp(0.4rem,0.5vw,0.8rem)] pb-2">{children}</div>
    </section>
  );
}

function CrmChip({ crm, name }: { crm: string; name: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 font-medium", T.tiny)} style={{ color: crmTone(crm) }}>
      {crmTag(crm, name)}
    </span>
  );
}

function BreakPanel({ people, serverNow, tv }: { people: SalesTvBreak[]; serverNow: number; tv: boolean }) {
  return (
    <Panel title="On break" dot="var(--warn)" count={people.length} className={cn(tv && "lg:flex-[3]")} testId="on-break">
      {people.length === 0 ? (
        <p className={cn("px-2 py-6 text-center text-[color:var(--mute)]", T.small)}>Nobody is on a break.</p>
      ) : (
        <ul>
          {people.map((b) => {
            const away = serverNow - Date.parse(b.since);
            const long = away > LONG_BREAK_MS;
            return (
              <li key={`${b.crm}:${b.id}`} className="flex items-center gap-[clamp(0.5rem,0.6vw,0.9rem)] border-b border-[color:var(--line)] px-[clamp(0.4rem,0.5vw,0.7rem)] py-[clamp(0.35rem,0.45vw,0.65rem)] last:border-b-0">
                <Photo name={b.name} url={b.photoUrl} className="h-[clamp(2.4rem,2.7vw,3.8rem)] w-[clamp(2.4rem,2.7vw,3.8rem)] rounded-[24%]" />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate font-semibold leading-tight", T.body)}>{b.name}</p>
                  <p className="flex min-w-0 items-center gap-1.5">
                    <CrmChip crm={b.crm} name={b.crmName} />
                    {b.team && <span className={cn("truncate text-[color:var(--mute)]", T.tiny)}>· {b.team}</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn("num font-bold leading-tight", T.title, long ? "text-[color:var(--bad)]" : "text-[color:var(--warn)]")}>{fmtClock(away)}</p>
                  <p className={cn("text-[color:var(--mute)]", T.tiny)}>{breakLabel(b.kind)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function RecentCloses({ closes, tv }: { closes: SalesTvClose[]; tv: boolean }) {
  const shown = closes.slice(0, 8);
  return (
    <Panel title="Latest closes" dot="var(--good)" hint="Closes in the last 2 hours" className={cn(tv && "lg:flex-[2]")} testId="recent-closes">
      {shown.length === 0 ? (
        <p className={cn("px-2 py-6 text-center text-[color:var(--mute)]", T.small)}>No closes yet.</p>
      ) : (
        <ul>
          {shown.map((c) => (
            <li key={c.key} className="flex items-center gap-[clamp(0.5rem,0.6vw,0.9rem)] border-b border-[color:var(--line)] px-[clamp(0.4rem,0.5vw,0.7rem)] py-[clamp(0.35rem,0.45vw,0.65rem)] last:border-b-0">
              <span className={cn("num shrink-0 text-[color:var(--mute)]", T.small)}>{dubaiHm(Date.parse(c.at))}</span>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate font-semibold leading-tight", T.body)}>{c.closer || "—"}</p>
                <p className="flex min-w-0 items-center gap-1.5">
                  <CrmChip crm={c.crm} name={c.crmName} />
                  {c.courses.length > 0 && <span className={cn("truncate text-[color:var(--mute)]", T.tiny)}>· {c.courses.join(", ")}</span>}
                </p>
              </div>
              <span className={cn("num shrink-0 font-bold text-[color:var(--money)]", T.body)}>{c.amount > 0 ? fmtMoney(c.amount, c.currency) : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Sound: browsers need one click first ───────────────────────────────────────

function SoundPrompt({ tv }: { tv: boolean }) {
  const pref = useSoundPref();
  const unlocked = useSoundUnlocked();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Makes the audio context now; a browser that allows sound without a click (a kiosk) runs it straight away.
    soundUnlocked();
    const t = window.setTimeout(() => setReady(true), 400);
    return () => window.clearTimeout(t);
  }, []);
  if (!ready || unlocked || pref === "off") return null;

  const enable = () => {
    unlockSound();
    setSoundPref("on");
  };

  // Asked before on this screen: the browser only needs a click again, so nothing blocks the board.
  if (pref === "on" || !tv) {
    return (
      <button
        type="button"
        onClick={enable}
        className="fixed bottom-4 left-1/2 z-[900] inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-[color:var(--warn)] bg-[color:var(--panel)] px-4 py-2 text-sm font-medium text-[color:var(--warn)]"
        data-testid="sound-banner"
      >
        <Volume2 className="h-4 w-4" /> Click to enable sound
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[950] grid place-items-center bg-black/75 p-4" onClick={enable} data-testid="sound-overlay">
      <div className="w-full max-w-md rounded-3xl border border-[color:var(--line)] bg-[color:var(--panel)] p-8 text-center" onClick={(e) => e.stopPropagation()}>
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[color:var(--accent)] text-white">
          <Volume2 className="h-7 w-7" />
        </span>
        <h2 className="text-2xl font-bold">Click to enable sound</h2>
        <p className="mt-2 text-[color:var(--ink2)]">Every close is announced with a sparkle and a voice. Browsers stay silent until somebody clicks once — this screen remembers.</p>
        <div className="mt-6 flex flex-col gap-2">
          <button type="button" onClick={enable} className="rounded-full bg-[color:var(--accent)] px-4 py-3 text-lg font-semibold text-white hover:opacity-90" data-testid="enable-sound">
            Enable sound
          </button>
          <button type="button" onClick={() => setSoundPref("off")} className="rounded-full px-4 py-2 text-sm text-[color:var(--mute)] hover:text-[color:var(--ink)]">
            Keep this screen silent
          </button>
        </div>
      </div>
    </div>
  );
}
