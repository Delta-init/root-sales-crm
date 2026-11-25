import crypto from "node:crypto";
import { getSources } from "./crmConnections.js";

/*
 * Finance's old books on the Manager TV (the user, 2026-11-25): each CRM counts the old-books invoices whose
 * salesperson is one of its users (their `oldbookssales`, in the CRM's own figures, so in the Sales TV / Manager TV
 * through the CRMs' answers). What no CRM can count — a salesperson who is no user in any CRM Root reads (Arya
 * Krishnan in November, AED 1,000) — is the Manager TV's own line, "Old books — no CRM user", and in its total.
 *
 * Asked of finance (GET /api/v1/integrations/old-books/payments?from=, signed like the CRMs' calls: FINANCE_API_URL —
 * else FINANCE_HQ_API_URL — FINANCE_CLIENT_ID and FINANCE_INTEGRATION_SECRET, the same client the CRMs use) at most
 * every five minutes per month. Finance away or not configured: the line is 0, with its reason, and the rest of the
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
const TIMEOUT_MS = 8_000;
const from = () => (/^\d{4}-\d{2}-\d{2}$/.test(process.env.OLD_BOOKS_FROM ?? "") ? process.env.OLD_BOOKS_FROM! : "2026-11-01");
const base = () => (process.env.FINANCE_API_URL || process.env.FINANCE_HQ_API_URL || "").replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const configured = () => Boolean(base() && process.env.FINANCE_CLIENT_ID && process.env.FINANCE_INTEGRATION_SECRET);

/** METHOD \n PATH_WITH_QUERY \n TIMESTAMP \n NONCE \n sha256(body) — finance's lib/signing.ts, as the CRMs sign. */
export function signRequest(secret: string, method: string, url: string, timestamp: string, nonce: string, rawBody: string): string {
  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  return crypto.createHmac("sha256", secret).update([method.toUpperCase(), url, timestamp, nonce, bodyHash].join("\n")).digest("hex");
}

async function fetchOldBooks(since: string): Promise<OldBooksInvoice[]> {
  const path = `/api/v1/integrations/old-books/payments?from=${encodeURIComponent(since)}`;
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString("hex");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base()}${path}`, {
      headers: {
        "x-delta-client": process.env.FINANCE_CLIENT_ID!,
        "x-delta-timestamp": timestamp,
        "x-delta-nonce": nonce,
        "x-delta-signature": signRequest(process.env.FINANCE_INTEGRATION_SECRET!, "GET", path, timestamp, nonce, ""),
      },
      signal: controller.signal,
    });
    if (res.status === 404) throw new Error("Finance's server needs updating — it has no old-books list yet");
    if (!res.ok) throw new Error(`Finance answered ${res.status}`);
    const body = (await res.json()) as { data?: OldBooksInvoice[] };
    return Array.isArray(body.data) ? body.data : [];
  } catch (err) {
    throw (err as Error)?.name === "AbortError" ? new Error("Finance didn't answer in time") : err;
  } finally {
    clearTimeout(timer);
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
    if (!configured()) {
      line = { monthAed: 0, rows: [], status: "off", error: "Finance isn't configured on this server (FINANCE_API_URL, FINANCE_CLIENT_ID, FINANCE_INTEGRATION_SECRET)" };
    } else {
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
