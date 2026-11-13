/**
 * The CS TV amounts page's routes end to end (routes/csTvAmountsRoutes.ts, services/csTvAmountsService.ts):
 *
 *   Case 1  happy path   the month's amounts, the Bangalore CSs and the courses as CS Portal lists them, in this
 *                        portal's own words; adding, changing and removing one reach CS Portal as it takes them —
 *                        with the secret, and the root admin's email as who did it
 *   Case 2  edge         a month that isn't one is not passed on; `at` left out stays out (CS Portal's "now"); a
 *                        change carries only what was given
 *   Case 3  errors       nonsense never leaves this portal (no employee, no amount, no course, a TV that isn't one);
 *                        CS Portal's own refusal comes through in its words; a CS Portal server from before these
 *                        routes says it needs updating; CS Portal not in the registry says so
 *   Case 4  permission   no session 401, not a root admin 403 — on every route
 *
 * Run through scripts/cs-tv-amounts-check.sh. Scratch database on 127.0.0.1 only; CS Portal is a stand-in.
 */
import mongoose from "mongoose";
import { createServer } from "node:http";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${uri}"`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "CsTvAmountsE2e!pass1";
const SECRET = "cs-tv-amounts-e2e-commission";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 500);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ── The stand-in: CS Portal's /api/v1/service/cs-tv-amounts ──────────────────
const BELA = "64b000000000000000000001", AMOUNT = "64b0000000000000000000a1";
const hits: { method: string; path: string; body: Json; secret: boolean }[] = [];
let old = false;
const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const body: Json = (() => { try { return JSON.parse(raw || "{}"); } catch { return {}; } })();
    const path = url.pathname.replace("/commission/api/v1/service", "") + url.search;
    hits.push({ method: req.method ?? "", path, body, secret: req.headers["x-portal-secret"] === SECRET });
    if (req.headers["x-portal-secret"] !== SECRET) return send(401, { success: false, error: { code: "UNAUTHORISED", message: "Bad secret" } });
    if (old || !url.pathname.startsWith("/commission/api/v1/service/cs-tv-amounts")) return send(404, { success: false, error: { code: "NOT_FOUND", message: "No such service route" } });
    if (req.method === "GET") {
      return send(200, { success: true, data: {
        location: "bangalore", month: url.searchParams.get("month") ?? "2026-11",
        extras: [{ id: AMOUNT, cs_id: BELA, cs_name: "Bela", aed: 9000, product: "MSNR", at: "2026-11-13T10:00:00.000Z", show_on: "dubai", added_by: "root@cs-tv-amounts-e2e.test (Root)", added_at: "2026-11-13T10:00:01.000Z" }],
        cs: [{ id: BELA, name: "Bela", team: "Team Bangalore" }], products: ["DGMP", "MSNR"], total_aed: 9000,
      } });
    }
    if (url.pathname.endsWith("/cs-tv-amounts")) {
      if (body.cs_id !== BELA) return send(400, { success: false, error: { code: "VALIDATION_ERROR", message: "Pick one of Bangalore's CSs" } });
      return send(200, { success: true, data: { id: AMOUNT } });
    }
    if (url.pathname.endsWith("/update") || url.pathname.endsWith("/remove")) {
      if (body.id !== AMOUNT) return send(404, { success: false, error: { code: "NOT_FOUND", message: "That amount is no longer there" } });
      return send(200, { success: true, data: url.pathname.endsWith("/remove") ? { removed: true } : { id: AMOUNT } });
    }
    send(404, { success: false, error: { code: "NOT_FOUND", message: "No such service route" } });
  });
});
await new Promise<void>((ok) => stand.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));
const last = () => hits[hits.length - 1]!;

async function main() {
  mongoose.set("autoIndex", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();

  step("Setting up: two admins, CS Portal not in the registry yet");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  await AdminUser.create({ name: "Root E2E", email: "root@cs-tv-amounts-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@cs-tv-amounts-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@cs-tv-amounts-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@cs-tv-amounts-e2e.test")}` };

  let r = await call("GET", "/cs-tv-amounts", root);
  check("CS Portal not in the registry: said so, and nobody asked", r.status === 409 && /not set up/i.test(r.body?.message ?? "") && hits.length === 0, show(r.body));
  await Organization.create({ code: "commission", kind: "commission", name: "CS Portal", timezone: "Asia/Dubai", currency: "USD", fxToBase: 1, isActive: true, sortOrder: 5, accent: "#0d9488" });

  step("Case 4 — root admins only");
  for (const [method, path, body] of [["GET", "/cs-tv-amounts", undefined], ["POST", "/cs-tv-amounts", {}], ["PATCH", `/cs-tv-amounts/${AMOUNT}`, {}], ["DELETE", `/cs-tv-amounts/${AMOUNT}`, undefined]] as [string, string, unknown][]) {
    check(`${method} ${path.replace(AMOUNT, ":id")}: no session 401, not a root admin 403`, (await call(method, path, {}, body)).status === 401 && (await call(method, path, member, body)).status === 403);
  }
  check("…and CS Portal was never asked", hits.length === 0, show(hits));

  step("Case 1 — happy path");
  r = await call("GET", "/cs-tv-amounts?month=2026-11", root);
  same("the month's amounts, in this portal's words", r.body?.data, {
    month: "2026-11",
    amounts: [{ id: AMOUNT, employeeId: BELA, employee: "Bela", aed: 9000, course: "MSNR", at: "2026-11-13T10:00:00.000Z", showOn: "dubai", addedBy: "root@cs-tv-amounts-e2e.test (Root)", addedAt: "2026-11-13T10:00:01.000Z" }],
    employees: [{ id: BELA, name: "Bela", team: "Team Bangalore" }], courses: ["DGMP", "MSNR"], totalAed: 9000,
  });
  check("…asked of CS Portal with the secret, for that month", last().method === "GET" && last().path === "/cs-tv-amounts?month=2026-11" && last().secret, show(last()));

  r = await call("POST", "/cs-tv-amounts", root, { employeeId: BELA, aed: 12000, course: " MSNR ", showOn: "dubai", at: "2026-11-13T12:30:00+04:00" });
  check("adding one: 200 with its id", r.status === 200 && r.body?.data?.id === AMOUNT, show(r.body));
  same("…as CS Portal takes it, with who added it", last().body, { cs_id: BELA, aed: 12000, product: "MSNR", show_on: "dubai", at: "2026-11-13T08:30:00.000Z", by: "root@cs-tv-amounts-e2e.test" });
  check("…POST /cs-tv-amounts", last().method === "POST" && last().path === "/cs-tv-amounts" && last().secret, show(last()));

  r = await call("PATCH", `/cs-tv-amounts/${AMOUNT}`, root, { aed: 15000, course: "DGMP", showOn: "both", at: "2026-11-13T09:00:00.000Z" });
  check("changing it: 200", r.status === 200, show(r.body));
  same("…as CS Portal takes it", last().body, { id: AMOUNT, aed: 15000, product: "DGMP", show_on: "both", at: "2026-11-13T09:00:00.000Z", by: "root@cs-tv-amounts-e2e.test" });
  check("…POST /cs-tv-amounts/update", last().path === "/cs-tv-amounts/update", show(last()));

  r = await call("DELETE", `/cs-tv-amounts/${AMOUNT}`, root);
  check("removing it: 200", r.status === 200 && r.body?.data?.removed === true, show(r.body));
  same("…POST /cs-tv-amounts/remove with its id", [last().path, last().body], ["/cs-tv-amounts/remove", { id: AMOUNT }]);

  step("Case 2 — edges");
  await call("GET", "/cs-tv-amounts?month=2026-13", root);
  check("a month that isn't one: not passed on (CS Portal gives this month's)", last().path === "/cs-tv-amounts", show(last()));
  await call("GET", "/cs-tv-amounts", root);
  check("no month: none passed on", last().path === "/cs-tv-amounts", show(last()));
  await call("POST", "/cs-tv-amounts", root, { employeeId: BELA, aed: "2500.5", course: "MSNR", showOn: "bangalore" });
  same("no time given: none sent — CS Portal's now", last().body, { cs_id: BELA, aed: 2500.5, product: "MSNR", show_on: "bangalore", by: "root@cs-tv-amounts-e2e.test" });
  await call("PATCH", `/cs-tv-amounts/${AMOUNT}`, root, { showOn: "bangalore" });
  same("a change of the TV alone carries only that", last().body, { id: AMOUNT, show_on: "bangalore", by: "root@cs-tv-amounts-e2e.test" });

  step("Case 3 — errors");
  const before = hits.length;
  for (const [label, body] of [
    ["no employee", { aed: 100, course: "MSNR", showOn: "dubai" }],
    ["no amount", { employeeId: BELA, aed: 0, course: "MSNR", showOn: "dubai" }],
    ["an amount that isn't a number", { employeeId: BELA, aed: "lots", course: "MSNR", showOn: "dubai" }],
    ["no course", { employeeId: BELA, aed: 100, course: "  ", showOn: "dubai" }],
    ["a TV that isn't one", { employeeId: BELA, aed: 100, course: "MSNR", showOn: "mars" }],
    ["no TV said", { employeeId: BELA, aed: 100, course: "MSNR" }],
    ["a date that isn't one", { employeeId: BELA, aed: 100, course: "MSNR", showOn: "dubai", at: "yesterday-ish" }],
  ] as [string, unknown][]) {
    const bad = await call("POST", "/cs-tv-amounts", root, body);
    check(`adding with ${label}: 400, in words`, bad.status === 400 && !!bad.body?.message, show(bad.body));
  }
  r = await call("PATCH", `/cs-tv-amounts/${AMOUNT}`, root, {});
  check("a change of nothing: 400", r.status === 400, show(r.body));
  r = await call("PATCH", "/cs-tv-amounts/not-an-id", root, { aed: 5 });
  check("an id that isn't one: 404", r.status === 404 && (await call("DELETE", "/cs-tv-amounts/not-an-id", root)).status === 404, show(r.body));
  check("…none of which reached CS Portal", hits.length === before, show(hits.slice(before)));

  r = await call("POST", "/cs-tv-amounts", root, { employeeId: "64b0000000000000000000ff", aed: 100, course: "MSNR", showOn: "dubai" });
  check("CS Portal's own refusal (a Dubai CS), in its words", r.status === 409 && /Pick one of Bangalore's CSs/.test(r.body?.message ?? ""), show(r.body));
  r = await call("DELETE", "/cs-tv-amounts/64b0000000000000000000ff", root);
  check("an amount already removed: CS Portal's words, not \"needs updating\"", r.status === 409 && /no longer there/.test(r.body?.message ?? "") && !/updating/.test(r.body?.message ?? ""), show(r.body));
  old = true;
  r = await call("GET", "/cs-tv-amounts", root);
  check("a CS Portal server from before these routes: says it needs updating", r.status === 409 && /needs updating/.test(r.body?.message ?? ""), show(r.body));
  old = false;

  console.log(`\n${checks - failures}/${checks} checks passed`);
}

main()
  .catch((err) => { console.error(err); failures++; })
  .finally(async () => {
    stand.close();
    await mongoose.disconnect().catch(() => {});
    process.exit(failures ? 1 : 0);
  });
