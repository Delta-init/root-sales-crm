/**
 * Who booked a meeting, and the meetings a person booked (2026-11-18):
 *
 *   Case 1  the calendar   GET /mentors/schedule names each meeting's booker — a sales CRM's user (its database),
 *                          else a CS Portal account (with the role), else a Root admin; nobody found: null; any case
 *   Case 2  the report     GET /meetings-booked?email=&from=&to= asks the LMS for that address and the period's Gulf
 *                          days, and passes its answer on; no period: the last 339 days and the coming 60
 *   Case 3  edges          a period over 400 days: its last 400, said so; no email / not one: 400
 *   Case 4  errors         an LMS from before the route: says it needs updating
 *   Case 5  permission     no session 401, not a root admin 403 (the calendar is open to anybody signed in)
 *
 * Run through scripts/booked-meetings-check.sh. Scratch databases on 127.0.0.1 only; the LMS and CS Portal are stand-ins.
 */
import mongoose from "mongoose";
import { createServer } from "node:http";

const uri = process.env.MONGODB_URI ?? "";
const drawUri = process.env.E2E_DRAW_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri) || !/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(drawUri)) {
  console.error(`Refusing to run: needs scratch e2e databases on 127.0.0.1, got "${uri}" / "${drawUri}"`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "BookedMeetingsE2e!pass1";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 500);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}${path}`, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ── The stand-ins: the LMS's /service/mentors + /service/meetings-booked, CS Portal's /service/user ──
const asked: string[] = [];
let oldLms = false;
const meeting = (id: string, bookedByEmail: string) => ({ id, title: `Meeting ${id}`, kind: "student", startsAt: new Date().toISOString(), durationMins: 30, attendeeNames: ["Student A"], bookedByEmail });
const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  asked.push(url.pathname + url.search);
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/lms/api/v1/service/mentors") {
    return send(200, { success: true, data: { timezone: "Asia/Dubai", from: url.searchParams.get("from"), to: url.searchParams.get("to"), mentors: [
      { id: "m1", name: "Mentor One", email: "one@lms.e2e", shared: false, slots: [], classes: [], meetings: [
        meeting("a", "seller@draw.e2e"), meeting("b", "CS.Person@portal.e2e"), meeting("c", "root@booked-meetings-e2e.test"), meeting("d", "nobody@else.e2e"),
      ] },
    ] } });
  }
  if (url.pathname === "/lms/api/v1/service/meetings-booked") {
    if (oldLms) return send(404, { success: false, message: "Route not found" });
    return send(200, { success: true, data: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), total: 1,
      counts: { upcoming: 0, done: 1, waiting: 0, cancelled: 0 }, meetings: [{ id: "x1", title: "Pitch", status: "done", mentor: { name: "Mentor One", email: "one@lms.e2e" } }] } });
  }
  if (url.pathname === "/commission/api/v1/service/user") {
    const e = url.searchParams.get("email");
    if (e === "cs.person@portal.e2e") return send(200, { success: true, data: { exists: true, name: "CS Person", roleName: "CS Executive" } });
    return send(200, { success: true, data: { exists: false, name: "", roleName: null } });
  }
  send(404, { success: false, message: "Not found" });
});
await new Promise<void>((ok) => stand.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));

async function main() {
  mongoose.set("autoIndex", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();
  const draw = await mongoose.createConnection(drawUri).asPromise();
  await draw.db!.dropDatabase();
  await draw.collection("users").insertOne({ name: "Seller Draw", email: "seller@draw.e2e", status: "active" });

  step("Setting up: two admins; LMS, CS Portal and Draw in the registry");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  await AdminUser.create({ name: "Root E2E", email: "root@booked-meetings-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@booked-meetings-e2e.test", password: PASSWORD, role: "member", status: "active" });
  await Organization.create({ code: "lms", kind: "lms", name: "LMS", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 6, accent: "#7c3aed" });
  await Organization.create({ code: "commission", kind: "commission", name: "CS Portal", timezone: "Asia/Dubai", currency: "USD", fxToBase: 1, isActive: true, sortOrder: 5, accent: "#0d9488" });
  await Organization.create({ code: "draw", kind: "crm", name: "Draw", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 2, accent: "#2563eb" });
  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@booked-meetings-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@booked-meetings-e2e.test")}` };

  step("Case 1 · the calendar names who booked");
  let r = await call("/mentors/schedule", member);
  const ms = r.body?.data?.mentors?.[0]?.meetings ?? [];
  const of = (id: string) => ms.find((m: Json) => m.id === id)?.bookedBy;
  check("open to anybody signed in, as before", r.status === 200 && ms.length === 4, show(r.body));
  check("a sales CRM's user: name, the CRM, Salesperson", JSON.stringify(of("a")) === JSON.stringify({ name: "Seller Draw", where: "Draw", role: "Salesperson" }), show(of("a")));
  check("a CS Portal account (address in another case): name, CS Portal, its role", JSON.stringify(of("b")) === JSON.stringify({ name: "CS Person", where: "CS Portal", role: "CS Executive" }), show(of("b")));
  check("a Root admin", of("c")?.name === "Root E2E" && of("c")?.where === "Root", show(of("c")));
  check("nobody anywhere: null, the address stays", of("d") === null && ms.find((m: Json) => m.id === "d")?.bookedByEmail === "nobody@else.e2e", show(ms[3]));
  const before = asked.filter((a) => a.includes("/service/user")).length;
  await call("/mentors/schedule", member);
  check("asked again: the names are kept, CS Portal not asked again", asked.filter((a) => a.includes("/service/user")).length === before, String(asked.filter((a) => a.includes("/service/user")).length - before));

  step("Case 5 · permission");
  check("the report: no session 401", (await call("/meetings-booked?email=seller@draw.e2e")).status === 401);
  check("the report: not a root admin 403", (await call("/meetings-booked?email=seller@draw.e2e", member)).status === 403);

  step("Case 2 · the report");
  r = await call("/meetings-booked?email=Seller@Draw.e2e&from=2026-11-01&to=2026-11-30", root);
  const last = asked.filter((a) => a.startsWith("/lms/api/v1/service/meetings-booked")).at(-1) ?? "";
  check("asks the LMS for that address (lowercased) and the period's Gulf days", last.includes("emails=seller%40draw.e2e") && last.includes("from=2026-11-01") && last.includes("to=2026-11-30"), last);
  check("passes the LMS's answer on", r.status === 200 && r.body?.data?.counts?.done === 1 && r.body?.data?.meetings?.[0]?.title === "Pitch" && r.body?.data?.clipped === false, show(r.body));
  r = await call("/meetings-booked?email=seller@draw.e2e", root);
  const d = r.body?.data;
  const span = (Date.parse(d?.to) - Date.parse(d?.from)) / 86_400_000;
  check("no period: the last 339 days and the coming 60, not cut", r.status === 200 && span === 399 && d?.clipped === false, show({ from: d?.from, to: d?.to, span }));

  step("Case 3 · edges");
  r = await call("/meetings-booked?email=seller@draw.e2e&from=2024-01-01&to=2026-11-30", root);
  check("over 400 days: its last 400, said so", r.body?.data?.clipped === true && r.body?.data?.to === "2026-11-30" && (Date.parse(r.body.data.to) - Date.parse(r.body.data.from)) / 86_400_000 === 399, show(r.body?.data));
  check("no email: 400", (await call("/meetings-booked?from=2026-11-01", root)).status === 400);
  check("not an email: 400", (await call("/meetings-booked?email=seller", root)).status === 400);

  step("Case 4 · an LMS from before the route");
  oldLms = true;
  r = await call("/meetings-booked?email=seller@draw.e2e&from=2026-11-01&to=2026-11-30", root);
  check("says the LMS needs updating", r.status === 409 && /needs updating/i.test(r.body?.message ?? ""), show(r.body));

  await draw.dropDatabase().catch(() => {});
  await draw.close();
  console.log(`\n${checks - failures}/${checks} checks passed`);
}

main()
  .catch((err) => { failures++; console.error(err); })
  .finally(async () => { stand.close(); await mongoose.disconnect().catch(() => {}); process.exit(failures ? 1 : 0); });
