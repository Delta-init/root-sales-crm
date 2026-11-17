/**
 * The Mentors TV end to end (routes/mentorsTvRoutes.ts, the open GET /public/mentors-tv, services/mentorsTvService.ts):
 *
 *   Case 1  happy path   the mentors' card in the Sales TV's shape (revenue, today, payments, meetings, role · team,
 *                        photo), no CRM cards; each location asks CS Portal for its own board
 *   Case 2  pop-ups      a new mentor payment comes as a close (kind mentor_payment) once; ?since= brings only what
 *                        is new
 *   Case 3  past month   ?month= passed on to CS Portal, its standings, no closes; a month to come is "now"
 *   Case 4  errors       CS Portal from before the board: says it needs updating (signed in), a plain sentence (open)
 *   Case 5  permission   no session 401, not a root admin 403; the open link needs nothing and carries no email
 *
 * Run through scripts/mentors-tv-check.sh. Scratch database on 127.0.0.1 only; CS Portal is a stand-in.
 */
import mongoose from "mongoose";
import { createServer } from "node:http";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${uri}"`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "MentorsTvE2e!pass1";

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

// ── The stand-in: CS Portal's open /api/public/mentor-tv ─────────────────────
const asked: string[] = [];
let old = false;
const thisMonth = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 7);
const pays = [{ id: "p1", mentor: "Mentor One", team: "Mentors Dubai", aed: 2250, product: "DGMP", at: new Date().toISOString() }];
const boardFor = (location: string, month: string | null) => ({
  location, month: month ?? thisMonth, past: !!month, generated_at: new Date().toISOString(), meetings_available: true,
  mentors: location === "bangalore"
    ? [{ id: "b1", name: "Mentor Blr", role: "Junior Mentor", team: "Mentors Bangalore", month_aed: 3000, today_aed: 0, payments: 1, today_payments: 0, meetings: 1, photo: null, rank: 1 }]
    : [
        { id: "m1", name: "Mentor One", role: "Senior Mentor", team: "Mentors Dubai", month_aed: month ? 1000 : 7250, today_aed: month ? 0 : 2250, payments: 2, today_payments: 1, meetings: 2, photo: "https://x/one.jpg", rank: 1 },
        { id: "m2", name: "Mentor Two", role: "Junior Mentor", team: "Mentors Dubai", month_aed: 0, today_aed: 0, payments: 0, today_payments: 0, meetings: 3, photo: null, rank: 2 },
      ],
  totals: { month_aed: 7250, today_aed: 2250, payments: 2, meetings: 5 },
  recent: month || location === "bangalore" ? [] : pays,
});
const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  asked.push(url.pathname + url.search);
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (old) return send(404, { error: "Not found" });
  if (url.pathname === "/commission/api/public/mentor-tv") return send(200, boardFor(url.searchParams.get("location") ?? "dubai", url.searchParams.get("month")));
  send(404, { error: "Not found" });
});
await new Promise<void>((ok) => stand.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));

async function main() {
  mongoose.set("autoIndex", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();

  step("Setting up: two admins, CS Portal in the registry");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  await AdminUser.create({ name: "Root E2E", email: "root@mentors-tv-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@mentors-tv-e2e.test", password: PASSWORD, role: "member", status: "active" });
  await Organization.create({ code: "commission", kind: "commission", name: "CS Portal", timezone: "Asia/Dubai", currency: "USD", fxToBase: 1, isActive: true, sortOrder: 5, accent: "#0d9488" });
  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@mentors-tv-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@mentors-tv-e2e.test")}` };

  step("Case 5 · permission");
  check("no session: 401", (await call("/mentors-tv")).status === 401);
  check("not a root admin: 403", (await call("/mentors-tv", member)).status === 403);

  step("Case 1 · happy path");
  let r = await call("/mentors-tv?location=dubai", root);
  const d = r.body?.data;
  check("answers, no CRM cards, Dubai", r.status === 200 && Array.isArray(d?.crms) && d.crms.length === 0 && d.location === "dubai" && d.past === false, show(r.body));
  const one = d?.cs?.people?.find((p: Json) => p.name === "Mentor One");
  check("the mentors' card in the Sales TV's shape", d?.cs?.code === "cs" && d.cs.name === "Mentors" && d.cs.status === "ok" && d.cs.people.length === 2, show(d?.cs));
  check("a mentor: revenue, today, payments, meetings, role · team, photo", one?.monthAed === 7250 && one?.todayAed === 2250 && one?.payments === 2 && one?.todayPayments === 1
    && one?.meetings === 2 && one?.team === "Senior Mentor · Mentors Dubai" && one?.photoUrl === "https://x/one.jpg", show(one));
  check("a mentor with meetings and no payment is there at AED 0", d?.cs?.people?.some((p: Json) => p.name === "Mentor Two" && p.monthAed === 0 && p.meetings === 3));
  check("totals with meetings", d?.cs?.totals?.monthAed === 7250 && d?.cs?.totals?.meetings === 5, show(d?.cs?.totals));
  r = await call("/mentors-tv?location=bangalore", root);
  check("Bangalore asks for its own board", r.body?.data?.location === "bangalore" && r.body?.data?.cs?.people?.map((p: Json) => p.name).join() === "Mentor Blr"
    && asked.some((a) => a.includes("location=bangalore")), show(r.body?.data?.cs?.people));

  step("Case 2 · pop-ups");
  r = await call("/mentors-tv?location=dubai", root);
  const closes = r.body?.data?.closes ?? [];
  check("a new mentor payment comes as a close", closes.length === 1 && closes[0].kind === "mentor_payment" && closes[0].key === "mentor:p1" && closes[0].closer === "Mentor One"
    && closes[0].amount === 2250 && closes[0].courses?.[0] === "DGMP" && closes[0].crm === "mentors", show(closes));
  r = await call(`/mentors-tv?location=dubai&since=${encodeURIComponent(r.body?.data?.serverTime)}`, root);
  check("?since= after it: not again", (r.body?.data?.closes ?? []).length === 0, show(r.body?.data?.closes));
  r = await call("/mentors-tv?location=bangalore", root);
  check("Bangalore: not Dubai's payment", (r.body?.data?.closes ?? []).length === 0);

  step("Case 3 · past month");
  const [y, m] = thisMonth.split("-").map(Number) as [number, number];
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  r = await call(`/mentors-tv?location=dubai&month=${lastMonth}`, root);
  check("last month: passed on, its standings, no closes", r.body?.data?.past === true && r.body?.data?.month === lastMonth && r.body?.data?.closes?.length === 0
    && r.body?.data?.cs?.people?.[0]?.monthAed === 1000 && asked.some((a) => a.includes(`month=${lastMonth}`)), show(r.body?.data));
  r = await call("/mentors-tv?location=dubai&month=2099-01", root);
  check("a month to come: now", r.body?.data?.past === false, show(r.body?.data?.past));

  step("Case 5 · the open link");
  r = await call("/public/mentors-tv?location=dubai");
  check("open, no session, same mentors", r.status === 200 && r.body?.data?.cs?.people?.length === 2, show(r.body));
  check("never an email", !JSON.stringify(r.body).includes("@"));

  step("Case 4 · CS Portal from before the board");
  old = true;
  // Root asks CS Portal at most every 20 seconds: wait that out.
  await new Promise((ok) => setTimeout(ok, 21_000));
  r = await call("/mentors-tv?location=dubai", root);
  check("signed in: says CS Portal needs updating", r.body?.data?.cs?.status === "error" && /needs updating/i.test(r.body?.data?.cs?.error ?? ""), show(r.body?.data?.cs));
  r = await call("/public/mentors-tv?location=dubai");
  check("open: a plain sentence", r.body?.data?.cs?.status === "error" && r.body?.data?.cs?.error === "The mentors' figures can't be reached right now.", show(r.body?.data?.cs));

  console.log(`\n${checks - failures}/${checks} checks passed`);
}

main()
  .catch((err) => { failures++; console.error(err); })
  .finally(async () => { stand.close(); await mongoose.disconnect().catch(() => {}); process.exit(failures ? 1 : 0); });
