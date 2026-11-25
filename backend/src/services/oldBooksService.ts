import { getSources } from "./crmConnections.js";
import { callTarget, resolveTarget } from "../lib/targetClient.js";

/*
 * Finance's old books on the Manager TV (the user, 2026-11-25): each CRM counts the old-books invoices whose
 * salesperson is one of its users (their `oldbookssales`, in the CRM's own figures, so in the Sales TV / Manager TV
 * through the CRMs' answers). What no CRM can count — a salesperson who is no user in any CRM Root reads (Arya
 * Krishnan in November, AED 1,000) — is the Manager TV's own line, "Old books — no CRM user", and in its total.
 *
 * Asked of finance (its /service/old-books/payments?from=, as Root asks finance everything: FINANCE_HQ_API_URL and
 * FINANCE_HQ_SSO_SECRET) at most every five minutes per month. Finance away or not configured: the line is 0, with its reason, and the rest of the
 * TV carries on. Only payments from OLD_BOOKS_FROM (default 1 Nov 2026) count, as in the CRMs.
 */

export interface OldBooksInvoice {
  invoiceId: string; invoiceNumber: string; customerName: string; salespersonName: string; salespersonEmail: string;
  course: string; currency: string; status: string;
  payments: { id: string; paidOn: string; amountMinor: number; method: string }[];
}
export interface OldBooksLine {
  monthAed: number;
  rows: { invoiceNumber: string; salesperson: string; amount: number; paidOn: string }[];
  status: "ok" | "error" | "off";
  error: string | null;
}

const EVERY_MS = 5 * 60_000;
const from = () => (/^\d{4}-\d{2}-\d{2}$/.test(process.env.OLD_BOOKS_FROM ?? "") ? process.env.OLD_BOOKS_FROM! : "2026-11-01");
/**
 * Finance is asked as Root asks it everything else (2026-11-25, the user: "it already has them — use these"): its
 * finance-hq target — FINANCE_HQ_API_URL and the secret Root shares with it, FINANCE_HQ_SSO_SECRET — at finance's
 * /service/old-books/payments. No other settings.
 */
async function fetchOldBooks(since: string): Promise<OldBooksInvoice[]> {
  const target = await resolveTarget("finance-hq");
  try {
    return await callTarget<OldBooksInvoice[]>(target, `/old-books/payments?from=${encodeURIComponent(since)}`, { method: "GET", verb: "share its old books" });
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (/refused with 404|Not found/i.test(msg)) throw new Error("Finance's server needs updating — it has no old-books list yet");
    throw err;
  }
}

/** Every CRM user's email Root can read (lower-case) — who a CRM counts old books for. Null when a CRM can't be read. */
async function crmEmails(): Promise<Set<string> | null> {
  const { sources, failures } = await getSources();
  if (failures.length) return null;
  const out = new Set<string>();
  for (const src of sources) {
    const users = await src.conn.collection("users").find({}, { projection: { email: 1 } }).toArray();
    for (const u of users) if (u.email) out.add(String(u.email).trim().toLowerCase());
  }
  return out;
}

const cache = new Map<string, { at: number; line: OldBooksLine }>();
const inflight = new Map<string, Promise<OldBooksLine>>();

/** The month's (YYYY-MM, Dubai) old-books money no CRM counts. Never throws. */
export async function oldBooksNoCrmUser(month: string): Promise<OldBooksLine> {
  const had = cache.get(month);
  if (had && Date.now() - had.at < EVERY_MS) return had.line;
  const running = inflight.get(month);
  if (running) return running;
  const job = (async (): Promise<OldBooksLine> => {
    let line: OldBooksLine;
    {
      try {
        const start = `${month}-01` > from() ? `${month}-01` : from();
        const [list, emails] = await Promise.all([fetchOldBooks(start), crmEmails()]);
        if (!emails) throw new Error("A CRM's users can't be read right now");
        const rows: OldBooksLine["rows"] = [];
        for (const inv of list) {
          if (inv.status === "void" || (inv.currency || "AED").toUpperCase() !== "AED") continue;
          if (inv.salespersonEmail && emails.has(inv.salespersonEmail.toLowerCase())) continue;
          for (const p of inv.payments) {
            if (p.paidOn.slice(0, 7) !== month || p.paidOn.slice(0, 10) < from()) continue;
            rows.push({ invoiceNumber: inv.invoiceNumber, salesperson: inv.salespersonName || "No salesperson", amount: Math.round(p.amountMinor) / 100, paidOn: p.paidOn.slice(0, 10) });
          }
        }
        rows.sort((a, b) => b.paidOn.localeCompare(a.paidOn));
        line = { monthAed: Math.round(rows.reduce((s, r) => s + r.amount * 100, 0)) / 100, rows, status: "ok", error: null };
      } catch (err) {
        line = { monthAed: 0, rows: [], status: "error", error: (err as Error)?.message || "Finance can't be reached" };
      }
    }
    cache.set(month, { at: line.status === "ok" ? Date.now() : Date.now() - EVERY_MS + 30_000, line });
    return line;
  })();
  inflight.set(month, job);
  try {
    return await job;
  } finally {
    inflight.delete(month);
  }
}

/** For the check script: forget what was asked. */
export function resetOldBooksForTests(): void {
  cache.clear();
  inflight.clear();
}
