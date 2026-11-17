/**
 * The CS & Mentors TV end to end (routes/csMentorsTvRoutes.ts, the open GET /public/cs-mentors-tv,
 * services/csMentorsTvService.ts):
 *
 *   Case 1  both halves   the CS card from CS Portal's CS board (the TV's own figures — never ?real=1), each team
 *                         with its leader; the mentors' card, each team with its Chief Mentor; each location its own
 *   Case 2  pop-ups       a new CS payment and a new mentor payment both come as closes, once; ?since= only what is new
 *   Case 3  past month    ?month= passed on to both boards, their standings, no closes
 *   Case 4  errors        CS Portal from before the leaders: teams still shown, no leader; one board down leaves the
 *                         other; the open link gets a plain sentence
 *   Case 5  permission    no session 401, not a root admin 403; the open link needs nothing and carries no email
 *
 * Run through scripts/cs-mentors-tv-check.sh. Scratch database on 127.0.0.1 only; CS Portal is a stand-in.
 */
import mongoose from "mongoose";
import { createServer } from "node:http";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${uri}"`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "CsMentorsTvE2e!pass1";

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

// ── The stand-in: CS Portal's open /api/public/cs-tv and /api/public/mentor-tv ──
const asked: string[] = [];
const stand_ = { csDown: false, noLeaders: false };
const thisMonth = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 7);
const now = () => new Date().toISOString();
const csBoard = (location: string, month: string | null) => ({
  location, month: month ?? thisMonth, generated_at: now(),
  cs: location === "bangalore"
    ? [{ id: "c9", name: "CS Blr", team_id: "t9", team: "Team Bangalore", month_aed: 4000, today_aed: 0, payments: 1, today_payments: 0, photo: null, rank: 1 }]
    : [
        { id: "c1", name: "CS One", team_id: "t1", team: "Team Mafia", month_aed: month ? 3000 : 9000, today_aed: month ? 0 : 1500, payments: 3, today_payments: 1, photo: "https://x/cs1.jpg", rank: 1 },
        { id: "c2", name: "CS Two", team_id: "t1", team: "Team Mafia", month_aed: 2000, today_aed: 0, payments: 1, today_payments: 0, photo: null, rank: 2 },
      ],
  teams: location === "bangalore"
    ? [{ id: "t9", team: "Team Bangalore", ...(stand_.noLeaders ? {} : { leader: "Lead Blr", leader_photo: null }), month_aed: 4000, today_aed: 0, payments: 1, cs_count: 1 }]
    : [{ id: "t1", team: "Team Mafia", ...(stand_.noLeaders ? {} : { leader: "Lead Mafia", leader_photo: "https://x/lead.jpg" }), month_aed: month ? 5000 : 11000, today_aed: month ? 0 : 1500, payments: 4, cs_count: 2 }],
  totals: { month_aed: location === "bangalore" ? 4000 : 11000, today_aed: location === "bangalore" ? 0 : 1500, payments: 4 },
  recent: month || location === "bangalore" ? [] : [{ id: "cp1", cs: "CS One", team: "Team Mafia", aed: 1500, product: "MSNR", at: now() }],
});
const mentorBoard = (location: string, month: string | null) => ({
  location, month: month ?? thisMonth, past: !!month, generated_at: now(), meetings_available: true,
  mentors: location === "bangalore"
    ? [{ id: "b1", name: "Mentor Blr", role: "Junior Mentor", team: "Mentors Bangalore", month_aed: 3000, today_aed: 0, payments: 1, today_payments: 0, meetings: 1, photo: null, rank: 1 }]
    : [
        { id: "m1", name: "Mentor One", role: "Chief Mentor", team: "Team Money Heist", month_aed: month ? 1000 : 7250, today_aed: month ? 0 : 2250, payments: 2, today_payments: 1, meetings: 2, photo: "https://x/one.jpg", rank: 1 },
        { id: "m2", name: "Mentor Two", role: "Junior Mentor", team: "Team Money Heist", month_aed: 500, today_aed: 0, payments: 1, today_payments: 0, meetings: 3, photo: null, rank: 2 },
        { id: "m3", name: "Mentor Three", role: "Senior Mentor", team: "Team Wall Street", month_aed: 4000, today_aed: 0, payments: 1, today_payments: 0, meetings: 1, photo: null, rank: 3 },
      ],
  totals: { month_aed: 11750, today_aed: 2250, payments: 4, meetings: 6 },
  recent: month || location === "bangalore" ? [] : [{ id: "p1", mentor: "Mentor One", team: "Team Money Heist", aed: 2250, product: "DGMP", at: now() }],
});
const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  asked.push(url.pathname + url.search);
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const loc = url.searchParams.get("location") ?? "dubai", month = url.searchParams.get("month");
  if (url.pathname === "/commission/api/public/cs-tv") return stand_.csDown ? send(500, { error: "CS board broke" }) : send(200, csBoard(loc, month));
  if (url.pathname === "/commission/api/public/mentor-tv") return send(200, mentorBoard(loc, month));
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
  await AdminUser.create({ name: "Root E2E", email: "root@cs-mentors-tv-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@cs-mentors-tv-e2e.test", password: PASSWORD, role: "member", status: "active" });
  await Organization.create({ code: "commission", kind: "commission", name: "CS Portal", timezone: "Asia/Dubai", currency: "USD", fxToBase: 1, isActive: true, sortOrder: 5, accent: "#0d9488" });
  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@cs-mentors-tv-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@cs-mentors-tv-e2e.test")}` };

  step("Case 5 · permission");
  check("no session: 401", (await call("/cs-mentors-tv")).status === 401);
  check("not a root admin: 403", (await call("/cs-mentors-tv", member)).status === 403);

  step("Case 1 · both halves");
  let r = await call("/cs-mentors-tv?location=dubai", root);
  const d = r.body?.data;
  check("answers, no CRM cards, Dubai, now", r.status === 200 && Array.isArray(d?.crms) && d.crms.length === 0 && d.location === "dubai" && d.past === false, show(r.body));
  check("the CS half: CS Portal's CS board, two CSs, total 11,000", d?.cs?.code === "cs" && d.cs.name === "CS" && d.cs.status === "ok" && d.cs.people.length === 2 && d.cs.totals.monthAed === 11000, show(d?.cs));
  const cs1 = d?.cs?.people?.find((p: Json) => p.name === "CS One");
  check("…a CS: collected, today, payments, team, photo", cs1?.monthAed === 9000 && cs1?.todayAed === 1500 && cs1?.payments === 3 && cs1?.team === "Team Mafia" && cs1?.photoUrl === "https://x/cs1.jpg", show(cs1));
  check("…its team with the leader named", d?.cs?.teams?.length === 1 && d.cs.teams[0].team === "Team Mafia" && d.cs.teams[0].leader === "Lead Mafia" && d.cs.teams[0].leaderPhotoUrl === "https://x/lead.jpg" && d.cs.teams[0].monthAed === 11000 && d.cs.teams[0].csCount === 2, show(d?.cs?.teams));
  check("…the TV's own figures: CS Portal asked without ?real=1", asked.some((a) => a.startsWith("/commission/api/public/cs-tv?location=dubai")) && !asked.some((a) => a.includes("real=1")), show(asked));
  check("the mentors' half: three mentors, total 11,750", d?.mentors?.name === "Mentors" && d.mentors.status === "ok" && d.mentors.people.length === 3 && d.mentors.totals.monthAed === 11750, show(d?.mentors));
  const mt = d?.mentors?.teams ?? [];
  check("…their teams, biggest first, each with its Chief Mentor where it has one",
    mt.map((t: Json) => t.team).join() === "Team Money Heist,Team Wall Street" && mt[0].leader === "Mentor One" && mt[0].leaderPhotoUrl === "https://x/one.jpg"
      && mt[0].monthAed === 7750 && mt[0].csCount === 2 && mt[1].leader === null && mt[1].monthAed === 4000, show(mt));
  r = await call("/cs-mentors-tv?location=bangalore", root);
  check("Bangalore asks for its own boards", r.body?.data?.location === "bangalore" && r.body?.data?.cs?.people?.map((p: Json) => p.name).join() === "CS Blr"
    && r.body?.data?.mentors?.people?.map((p: Json) => p.name).join() === "Mentor Blr" && r.body?.data?.cs?.teams?.[0]?.leader === "Lead Blr", show(r.body?.data));
  r = await call("/mentors-tv?location=dubai", root);
  check("the Mentors TV now carries the mentors' teams too, its card otherwise the same", r.body?.data?.cs?.people?.length === 3 && r.body?.data?.cs?.teams?.length === 2, show(r.body?.data?.cs?.teams));

  step("Case 2 · pop-ups");
  r = await call("/cs-mentors-tv?location=dubai", root);
  const closes = r.body?.data?.closes ?? [];
  const csClose = closes.find((c: Json) => c.kind === "cs_payment");
  const mClose = closes.find((c: Json) => c.kind === "mentor_payment");
  check("a new CS payment comes as a close", closes.length === 2 && csClose?.key === "cs:cp1" && csClose.closer === "CS One" && csClose.amount === 1500 && csClose.courses?.[0] === "MSNR" && csClose.academy === "dubai", show(closes));
  check("…and a new mentor payment", mClose?.key === "mentor:p1" && mClose.closer === "Mentor One" && mClose.amount === 2250, show(closes));
  r = await call(`/cs-mentors-tv?location=dubai&since=${encodeURIComponent(r.body?.data?.serverTime)}`, root);
  check("?since= after them: neither again", (r.body?.data?.closes ?? []).length === 0, show(r.body?.data?.closes));
  r = await call("/cs-mentors-tv?location=bangalore", root);
  check("Bangalore: not Dubai's payments", (r.body?.data?.closes ?? []).length === 0);

  step("Case 3 · past month");
  const [y, m] = thisMonth.split("-").map(Number) as [number, number];
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  r = await call(`/cs-mentors-tv?location=dubai&month=${lastMonth}`, root);
  check("last month: both boards asked for it, their standings, no closes", r.body?.data?.past === true && r.body?.data?.month === lastMonth && r.body?.data?.closes?.length === 0
    && r.body?.data?.cs?.people?.[0]?.monthAed === 3000 && r.body?.data?.cs?.teams?.[0]?.monthAed === 5000 && r.body?.data?.mentors?.people?.[0]?.monthAed === 1000
    && asked.some((a) => a.includes("cs-tv") && a.includes(`month=${lastMonth}`)) && asked.some((a) => a.includes("mentor-tv") && a.includes(`month=${lastMonth}`)), show(r.body?.data));

  step("Case 5 · the open link");
  r = await call("/public/cs-mentors-tv?location=dubai");
  check("open, no session, both halves", r.status === 200 && r.body?.data?.cs?.people?.length === 2 && r.body?.data?.mentors?.people?.length === 3, show(r.body));
  check("never an email", !JSON.stringify(r.body).includes("@"));

  step("Case 4 · errors");
  stand_.noLeaders = true;
  r = await call(`/cs-mentors-tv?location=bangalore&month=${lastMonth}`, root);
  check("a CS Portal naming no leaders: the teams still shown, no leader", r.body?.data?.cs?.teams?.[0]?.team === "Team Bangalore" && r.body?.data?.cs?.teams?.[0]?.leader === null, show(r.body?.data?.cs?.teams));
  stand_.csDown = true;
  // Root asks CS Portal at most every 20 seconds: wait that out.
  await new Promise((ok) => setTimeout(ok, 21_000));
  r = await call("/cs-mentors-tv?location=dubai", root);
  check("the CS board down: its half says so, the mentors' half still there", r.body?.data?.cs?.status === "error" && /CS board broke/.test(r.body?.data?.cs?.error ?? "")
    && r.body?.data?.mentors?.status === "ok" && r.body?.data?.mentors?.people?.length === 3, show(r.body?.data?.cs));
  r = await call("/public/cs-mentors-tv?location=dubai");
  check("open: a plain sentence", r.body?.data?.cs?.status === "error" && r.body?.data?.cs?.error === "The CS figures can't be reached right now.", show(r.body?.data?.cs));

  console.log(`\n${checks - failures}/${checks} checks passed`);
}

main()
  .catch((err) => { failures++; console.error(err); })
  .finally(async () => { stand.close(); await mongoose.disconnect().catch(() => {}); process.exit(failures ? 1 : 0); });
