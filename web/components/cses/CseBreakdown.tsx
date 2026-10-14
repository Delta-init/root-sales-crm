"use client";

import { BreakdownDialog, Bars, type BarRow, type BreakdownTab } from "@/components/common/Breakdown";
import { FundingTable, UpgradesTable, AED_PER_USD, money, moneyOfUsd, STAGE_LABEL } from "@/components/cses/CseFunding";
import type { CseFigures, CseList, CseLocation, CsePerson } from "@/lib/types";

/*
 * The CSEs page's cards, each opened into what it is made of (the user,
 * 2026-10-14): by CSE, by team and by location — Dubai in AED, Bangalore in
 * INR — and, where there is one, the list behind it (the funding requests, the
 * upgrades). From what the page already has.
 */

export type CseCard = "deposits" | "commission" | "upgrades" | "students" | "balance" | "bonus" | "followups" | "notOnboarded" | "funding";

type Row = CsePerson & CseFigures;
const depositAed = (f: CseFigures) => f.deposits.aed ?? f.deposits.usd * AED_PER_USD;
const moneyList = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => v).map(([c, v]) => `${c} ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`).join(" · ");

/** One figure per CSE, then added up by team and by location. */
function cuts(rows: Row[], value: (r: Row) => number, display: (r: { value: number; location?: CseLocation; r?: Row }) => string, sub?: (r: Row) => string): BreakdownTab[] {
  const byCse: BarRow[] = rows.filter((r) => value(r)).map((r) => ({
    key: r.id, label: r.name, value: value(r), display: display({ value: value(r), location: r.location, r }),
    sub: [r.team, r.location === "bangalore" ? "Bangalore" : "", sub?.(r)].filter(Boolean).join(" · "),
  }));
  const teams = new Map<string, { value: number; location: CseLocation }>();
  for (const r of rows) {
    if (!value(r)) continue;
    const k = r.team || "No team";
    const t = teams.get(k) ?? { value: 0, location: r.location ?? "dubai" };
    t.value += value(r);
    teams.set(k, t);
  }
  const loc = new Map<CseLocation, number>();
  for (const r of rows) loc.set(r.location ?? "dubai", (loc.get(r.location ?? "dubai") ?? 0) + value(r));
  return [
    { key: "cse", label: "By CSE", content: <Bars rows={byCse} empty="Nobody has any." /> },
    { key: "team", label: "By team", content: <Bars rows={Array.from(teams).map(([k, t]) => ({ key: k, label: k, value: t.value, display: display({ value: t.value, location: t.location }) }))} empty="Nobody has any." /> },
    { key: "location", label: "Dubai · Bangalore", content: <Bars rows={Array.from(loc).filter(([, v]) => v).map(([k, v]) => ({ key: k, label: k === "bangalore" ? "Bangalore (INR)" : "Dubai (AED)", value: v, display: display({ value: v, location: k }) }))} empty="Nobody has any." /> },
  ];
}

export function CseBreakdown({ card, list, onClose }: { card: CseCard | null; list: CseList; onClose: () => void }) {
  const rows = list.rows;
  const count = ({ value }: { value: number }) => value.toLocaleString("en-US");
  const href = (id: string) => (list.studentLink && id ? `${list.studentLink}${id}` : null);
  let title = "", description = "", tabs: BreakdownTab[] = [];
  switch (card) {
    case "deposits":
      title = "Total deposits"; description = "The period's approved deposits, by the CSE who raised them — in AED, a Bangalore CSE's in INR.";
      tabs = cuts(rows, depositAed, ({ value, location }) => money(value, location), (r) => `${r.deposits.count} deposit${r.deposits.count === 1 ? "" : "s"}`);
      break;
    case "commission":
      title = "Total commission"; description = "Commission credited in the period, by who it was credited to.";
      tabs = cuts(rows, (r) => r.commissionUsd, ({ value, location }) => moneyOfUsd(value, location));
      break;
    case "upgrades":
      title = "Course upgrades"; description = "Started in the period, or paid on in it — by CSE, and each upgrade.";
      tabs = [
        ...cuts(rows, (r) => r.upgrades?.count ?? 0, count, (r) => `${money(r.upgrades?.paidAed ?? 0, r.location)} paid`),
        ...(list.recentUpgrades ? [{ key: "list", label: "Each upgrade", content: <UpgradesTable rows={list.recentUpgrades} studentHref={href} /> }] : []),
      ];
      break;
    case "students":
      title = "Students"; description = "Students with a CSE now — theirs, Common CS too (a shared student counts for each).";
      tabs = cuts(rows, (r) => r.students, count);
      break;
    case "balance":
      title = "Balance due"; description = "Students still owing, by CSE — each currency on its own, never added together.";
      tabs = cuts(rows, (r) => r.balance.students, ({ value, r }) => (r ? moneyList(r.balance.amount) || String(value) : `${value} students`),
        (r) => `${r.balance.students} owing${r.overdueDues.count ? ` · ${r.overdueDues.count} overdue` : ""}`);
      break;
    case "bonus":
      title = "Bonus due"; description = "MT5 bonuses waiting, by their students' CSE.";
      tabs = cuts(rows, (r) => r.bonus.usd, ({ value, location }) => moneyOfUsd(value, location),
        (r) => `${r.bonus.clients} client${r.bonus.clients === 1 ? "" : "s"} · ${r.bonus.withFinance} with finance · ${r.bonus.waitingBroker} broker admin`);
      break;
    case "followups":
      title = "Follow-ups today"; description = "Follow-ups due today and overdue, by CSE.";
      tabs = [
        ...cuts(rows, (r) => r.followupsToday, count, (r) => (r.followupsOverdue ? `${r.followupsOverdue} overdue` : "")),
        { key: "overdue", label: "Overdue by CSE", content: <Bars rows={rows.filter((r) => r.followupsOverdue).map((r) => ({ key: r.id, label: r.name, value: r.followupsOverdue, sub: r.team }))} empty="Nothing overdue." /> },
      ];
      break;
    case "notOnboarded":
      title = "Not onboarded"; description = "New students their CSE has not sent the welcome to — 6 hours or more counted apart.";
      tabs = cuts(rows, (r) => r.notOnboarded, count, (r) => (r.notOnboardedLate ? `${r.notOnboardedLate} waiting 6h+` : ""));
      break;
    case "funding": {
      const f = list.totals?.funding;
      title = "Funding requests waiting"; description = "Where each is paused — sent back to the CSE, with finance, waiting for a broker admin — by CSE, and each request.";
      tabs = [
        { key: "stage", label: "By where it is", content: <Bars rows={f ? [
          { key: "sb", label: STAGE_LABEL.sent_back.label, value: f.sentBack },
          { key: "wf", label: STAGE_LABEL.with_finance.label, value: f.withFinance },
          { key: "wb", label: STAGE_LABEL.waiting_broker.label, value: f.waitingBroker },
        ].filter((x) => x.value) : []} empty="Nothing waiting." /> },
        ...cuts(rows, (r) => r.funding?.pending ?? 0, count, (r) => money(r.funding?.pendingAed ?? 0, r.location)),
        ...(list.funding ? [{ key: "list", label: "Each request", content: <FundingTable rows={list.funding.rows} total={list.funding.total} studentHref={href} /> }] : []),
      ];
      break;
    }
  }
  return <BreakdownDialog open={!!card} onClose={onClose} title={title} description={description} tabs={tabs} />;
}
