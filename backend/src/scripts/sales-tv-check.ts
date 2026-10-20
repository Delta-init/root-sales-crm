/**
 * Sales TV end to end (services/salesTvService.ts, routes/salesTvRoutes.ts, routes/publicRoutes.ts):
 *
 *   Case 1  happy path   the three CRMs merged: Delta's and Draw's tables, who is on a break with the HRMS
 *                        photo (signed POST to work-modes), the closes of both tagged with their CRM, newest first
 *   Case 2  edge         the cache — no CRM asked twice inside 5 s, live parts (with ?after=) after 5 s, the people
 *                        again only after 30 s; a close sent twice kept once; ?since= keeps only what is new;
 *                        HRMS asked once per email
 *   Case 3  errors       Remote's old server says it needs updating; Draw going down shows on Draw's table only,
 *                        the open answer says so without the CRM's own words
 *   Case 4  permission   /sales-tv: no session 401, not a root admin 403; /public/sales-tv open, with no email
 *                        anywhere in it
 *
 * Run through scripts/sales-tv-check.sh. Scratch database on 127.0.0.1 only; the CRMs and HRMS are a stand-in.
 */
import mongoose from "mongoose";
import crypto from "node:crypto";
import { createServer } from "node:http";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${uri}"`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "SalesTvE2e!pass1";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 500);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Json; text: string; headers: Headers }> {
  const r = await fetch(`${ROOT}${path}`, { headers: { "content-type": "application/json", ...headers } });
  const text = await r.text();
  let body: Json = {};
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body, text, headers: r.headers };
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

// ── The stand-in: three CRMs and HRMS ────────────────────────────────────────
const hits: { crm: string; query: string }[] = [];
const hrmsHits: { emails: string[]; signed: boolean }[] = [];
let drawDown = false;
const SECRETS: Record<string, string> = { delta: "sales-tv-e2e-delta", draw: "sales-tv-e2e-draw", remote: "sales-tv-e2e-remote" };

const deltaCloses = [
  { id: "d1", closer: "Asha", closerEmail: "asha@delta-e2e.test", courses: ["Forex Mastery"], amount: 5500, academy: "dubai", currency: "AED", at: ago(30) },
  { id: "d2", closer: "Bina", closerEmail: "bina@delta-e2e.test", courses: ["Crypto Pro", "Mentorship"], amount: 8000, academy: "dubai", currency: "AED", at: ago(10) },
  { id: "d-old", closer: "Asha", closerEmail: "asha@delta-e2e.test", courses: ["Old"], amount: 100, academy: "dubai", currency: "AED", at: ago(200) }, // older than 2 h: dropped
];
const drawCloses: Json[] = [
  { id: "w1", closer: "Wasim", closerEmail: "wasim@draw-e2e.test", courses: ["Draw Basics"], amount: 55000, academy: "bangalore", currency: "INR", at: ago(20) },
];

function crmAnswer(crm: string, url: URL) {
  const live = url.searchParams.get("parts") === "live";
  const after = url.searchParams.get("after");
  const list = crm === "delta" ? deltaCloses : drawCloses;
  // Delta ignores ?after= and sends everything again, so Root's dedupe is tested.
  const closes = crm === "delta" || !after ? list : list.filter((c) => Date.parse(c.at) > Date.parse(after));
  const onBreak = crm === "delta"
    ? [{ id: "u-bina", name: "Bina", email: "bina@delta-e2e.test", team: "Falcons", since: ago(12), kind: "lunch" }]
    : [{ id: "u-zed", name: "Zed", email: "zed@draw-e2e.test", team: "Tigers", since: ago(3), kind: null }];
  const base = { crm, generatedAt: new Date().toISOString(), onBreak, closes };
  if (live) return base;
  const people = crm === "delta"
    ? [
      { id: "u-asha", name: "Asha", email: "asha@delta-e2e.test", team: "Falcons", closingsMonth: 9, closingsToday: 1, revenueMonth: 50000, callsToday: 40, connectedToday: 22, talkSecondsToday: 5400 },
      { id: "u-bina", name: "Bina", email: "bina@delta-e2e.test", team: "Falcons", closingsMonth: 4, closingsToday: 1, revenueMonth: 30000, callsToday: 25, connectedToday: 11, talkSecondsToday: 2000 },
    ]
    : [{ id: "u-wasim", name: "Wasim", email: "wasim@draw-e2e.test", team: "Tigers", closingsMonth: 3, closingsToday: 1, revenueMonth: 9000, callsToday: 30, connectedToday: 15, talkSecondsToday: 3600 }];
  return { ...base, month: "2026-10", people };
}

const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const crm = url.pathname.split("/")[1] ?? "";
  if (crm === "hrms") {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const path = url.pathname.slice("/hrms".length) + url.search;
      const ts = String(req.headers["x-delta-timestamp"] ?? ""), nonce = String(req.headers["x-delta-nonce"] ?? "");
      const canonical = [req.method, path, ts, nonce, crypto.createHash("sha256").update(raw).digest("hex")].join("\n");
      const want = crypto.createHmac("sha256", "sales-tv-e2e-hrms-signing").update(canonical).digest("hex");
      const signed = req.headers["x-delta-signature"] === want && req.headers["x-delta-client"] === "sales-tv-e2e";
      const people: { email: string; name?: string }[] = (() => { try { return JSON.parse(raw).people ?? []; } catch { return []; } })();
      hrmsHits.push({ emails: people.map((p) => p.email), signed });
      if (!signed) return send(401, { success: false, message: "Bad signature" });
      if (req.method !== "POST" || path !== "/api/v1/integrations/directory/work-modes") return send(404, { success: false, message: "Route not found" });
      send(200, { success: true, data: people.map((p) => ({
        email: p.email, matchedBy: "email", hrmsEmail: p.email, hrmsName: p.name ?? null, workMode: "office", location: "Dubai", status: "active", designation: "Sales",
        photoUrl: p.email.startsWith("bina") ? "https://hrms-e2e.test/photos/bina.jpg?sig=abc" : null,
      })) });
    });
    return;
  }
  if (!SECRETS[crm]) return send(404, { success: false, message: "Route not found" });
  if (req.headers["x-portal-secret"] !== SECRETS[crm]) return send(401, { success: false, message: "Bad secret" });
  if (url.pathname !== `/${crm}/api/v1/service/sales-tv`) return send(404, { success: false, message: "Route not found" });
  hits.push({ crm, query: url.search });
  if (crm === "remote") return send(404, { success: false, message: "Route not found" }); // an old server
  if (crm === "draw" && drawDown) return send(500, { success: false, message: "Draw database exploded at 10.0.0.7" });
  send(200, { success: true, data: crmAnswer(crm, url) });
});
await new Promise<void>((ok) => stand.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));

const hitsOf = (crm: string) => hits.filter((h) => h.crm === crm);

async function main() {
  mongoose.set("autoIndex", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();

  step("Setting up: the registry and two admins");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, name, sortOrder] of [["delta", "Dubai Sales", 1], ["draw", "Draw CRM", 2], ["remote", "Remote CRM", 3]] as [string, string, number][]) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@sales-tv-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@sales-tv-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@sales-tv-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@sales-tv-e2e.test")}` };

  step("Case 1 — happy path: the three CRMs merged");
  const firstAt = Date.now();
  let r = await call("/sales-tv", root);
  const d = r.body?.data ?? {};
  check("200 with serverTime", r.status === 200 && typeof d.serverTime === "string", show(r.body));
  same("three CRMs in order, with names from the registry", (d.crms ?? []).map((c: Json) => [c.code, c.name]), [["delta", "Dubai Sales"], ["draw", "Draw CRM"], ["remote", "Remote CRM"]]);
  const crmOf = (data: Json, code: string) => (data.crms ?? []).find((c: Json) => c.code === code) ?? {};
  same("Delta's people, as the CRM sent them", crmOf(d, "delta").people?.map((p: Json) => [p.name, p.team, p.closingsMonth, p.closingsToday, p.callsToday, p.connectedToday, p.talkSecondsToday]),
    [["Asha", "Falcons", 9, 1, 40, 22, 5400], ["Bina", "Falcons", 4, 1, 25, 11, 2000]]);
  check("Delta and Draw ok, with this month", crmOf(d, "delta").status === "ok" && crmOf(d, "draw").status === "ok" && crmOf(d, "delta").month === "2026-10", show(d.crms));
  check("the signed-in answer keeps emails", crmOf(d, "delta").people?.[0]?.email === "asha@delta-e2e.test");
  same("closes of both CRMs, newest first, older than 2 h left out", (d.closes ?? []).map((c: Json) => c.key), ["delta:d2", "draw:w1", "delta:d1"]);
  const w1 = (d.closes ?? []).find((c: Json) => c.key === "draw:w1");
  check("a close: CRM code and name, closer, courses, amount and currency", w1?.crm === "draw" && w1.crmName === "Draw CRM" && w1.closer === "Wasim"
    && w1.courses[0] === "Draw Basics" && w1.amount === 55000 && w1.currency === "INR" && !("student" in w1), show(w1));
  same("on a break: both CRMs, longest first, with CRM and team", (d.onBreak ?? []).map((b: Json) => [b.name, b.crm, b.crmName, b.team, b.kind]),
    [["Bina", "delta", "Dubai Sales", "Falcons", "lunch"], ["Zed", "draw", "Draw CRM", "Tigers", null]]);
  same("photos from HRMS: Bina's link, Zed has none (initials)", (d.onBreak ?? []).map((b: Json) => b.photoUrl), ["https://hrms-e2e.test/photos/bina.jpg?sig=abc", null]);
  check("HRMS asked once, signed, for the people on a break and in the tables (each once)", hrmsHits.length === 1 && hrmsHits[0].signed
    && hrmsHits[0].emails.sort().join() === "asha@delta-e2e.test,bina@delta-e2e.test,wasim@draw-e2e.test,zed@draw-e2e.test", show(hrmsHits));
  same("the tables' people carry their photo too (the podium): Bina's link, Asha none", crmOf(d, "delta").people?.map((p: Json) => p.photoUrl),
    [null, "https://hrms-e2e.test/photos/bina.jpg?sig=abc"]);
  check("each CRM asked once, the full answer (no parts=live, no after yet)", hitsOf("delta").length === 1 && hitsOf("draw").length === 1 && hitsOf("delta")[0].query === "", show(hits));

  step("Case 3 — errors: Remote's old server");
  const remote = crmOf(d, "remote");
  check("Remote: outdated, its server needs updating; the others unaffected", remote.status === "outdated" && /Remote CRM's server needs updating/.test(remote.error ?? "") && (remote.people ?? []).length === 0, show(remote));

  step("Case 2 — the cache");
  const before = hits.length;
  await Promise.all([call("/sales-tv", root), call("/public/sales-tv"), call("/public/sales-tv"), call("/sales-tv", root)]);
  check("four screens inside 5 s: no CRM asked again", hits.length === before, show(hits.slice(before)));
  await sleep(5300);
  r = await call("/public/sales-tv");
  const liveHits = hits.slice(before);
  check("after 5 s: one live call per CRM", liveHits.filter((h) => h.crm === "delta").length === 1 && liveHits.filter((h) => h.crm === "draw").length === 1, show(liveHits));
  check("…parts=live, with after= the newest close seen", liveHits.filter((h) => h.crm !== "remote").every((h) => h.query.includes("parts=live"))
    && !!liveHits.find((h) => h.crm === "draw")?.query.includes("after="), show(liveHits));
  check("Remote's old server: not asked again inside 30 s", liveHits.filter((h) => h.crm === "remote").length === 0, show(liveHits));
  same("Delta sending its closes again: each kept once", (r.body?.data?.closes ?? []).filter((c: Json) => c.crm === "delta").map((c: Json) => c.id), ["d2", "d1"]);
  check("HRMS not asked again for the same people", hrmsHits.length === 1, show(hrmsHits));

  step("Case 2 — since: only what is new");
  const t0 = r.body?.data?.serverTime;
  r = await call(`/public/sales-tv?since=${encodeURIComponent(t0)}`);
  same("nothing new since the last answer", r.body?.data?.closes, []);
  drawCloses.push({ id: "w2", closer: "Wasim", closerEmail: "wasim@draw-e2e.test", courses: ["Draw Advanced"], amount: 7000, academy: "dubai", currency: "AED", at: ago(0) });
  await sleep(5300);
  r = await call(`/public/sales-tv?since=${encodeURIComponent(t0)}`);
  same("a close arriving after: only it", (r.body?.data?.closes ?? []).map((c: Json) => c.key), ["draw:w2"]);
  r = await call("/public/sales-tv?since=garbage");
  check("a since that isn't a date: ignored (everything)", r.status === 200 && (r.body?.data?.closes ?? []).length === 4, show(r.body?.data?.closes));

  step("Case 4 — the open answer has no emails");
  r = await call("/public/sales-tv");
  check("open: 200 without a session, noindex", r.status === 200 && /noindex/.test(r.headers.get("x-robots-tag") ?? ""), String(r.status));
  check("no email anywhere in it", !/@/.test(r.text.replace(/https:\/\/[^"]*/g, "")) && !/email/i.test(r.text), r.text.slice(0, 300));
  const pd = r.body?.data ?? {};
  check("…but names, teams, counts, photo links and close amounts", crmOf(pd, "delta").people?.[0]?.name === "Asha" && crmOf(pd, "delta").people?.[0]?.team === "Falcons"
    && crmOf(pd, "delta").people?.[0]?.closingsMonth === 9 && crmOf(pd, "delta").people?.[1]?.photoUrl?.startsWith("https://") && pd.onBreak?.[0]?.photoUrl?.startsWith("https://") && pd.closes?.[0]?.amount > 0, show(pd));
  check("…and no revenue figures", !/revenueMonth/.test(r.text));

  step("Case 3 — Draw goes down");
  drawDown = true;
  await sleep(5300);
  r = await call("/sales-tv", root);
  let draw = crmOf(r.body?.data ?? {}, "draw");
  check("signed in: Draw in error with the CRM's reason; its last table kept", draw.status === "error" && /Draw CRM would not share its Sales TV/.test(draw.error ?? "") && draw.people?.length === 1, show(draw));
  check("…Delta carries on", crmOf(r.body?.data ?? {}, "delta").status === "ok");
  r = await call("/public/sales-tv");
  draw = crmOf(r.body?.data ?? {}, "draw");
  check("open: a plain sentence, not the CRM's own words", draw.status === "error" && draw.error === "Draw CRM can't be reached right now." && !/10\.0\.0\.7/.test(r.text), show(draw));
  drawDown = false;

  step("Case 2 — the people again only after 30 s");
  const fullBefore = hitsOf("delta").filter((h) => !h.query.includes("parts=live")).length;
  await sleep(Math.max(0, firstAt + 31_000 - Date.now()));
  r = await call("/sales-tv", root);
  const fullAfter = hitsOf("delta").filter((h) => !h.query.includes("parts=live")).length;
  check("Delta asked for its people a second time, once", fullAfter === fullBefore + 1, `full calls ${fullBefore} → ${fullAfter}; ${show(hitsOf("delta"))}`);
  check("Remote asked again after 30 s, once", hitsOf("remote").length === 2, show(hitsOf("remote")));
  check("Draw back: ok again", crmOf(r.body?.data ?? {}, "draw").status === "ok", show(crmOf(r.body?.data ?? {}, "draw")));
  check("no CRM asked more often than once per 5 s overall", ["delta", "draw", "remote"].every((c) => hitsOf(c).length <= 10), show(hits.map((h) => h.crm)));

  step("Case 4 — root admins only for the signed-in page");
  check("no session: 401", (await call("/sales-tv")).status === 401);
  check("not a root admin: 403", (await call("/sales-tv", member)).status === 403);

  console.log(`\n${checks - failures}/${checks} checks passed`);
}

main()
  .catch((err) => { console.error(err); failures++; })
  .finally(async () => {
    stand.close();
    await mongoose.disconnect().catch(() => {});
    process.exit(failures ? 1 : 0);
  });
