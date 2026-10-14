/**
 * Checks Root's 3CX calls (2026-10-14) — the "3CX calls" page (GET /calls), a
 * recording's link (GET /calls/:portal/:id/recording-link) and each person's
 * calls on Pending (GET /pending/calls) — against a scratch database, with the
 * portals that sync 3CX (Sales CRM, Draw, Tetra Commission) as a stand-in in
 * this check answering /api/v1/service/calls, and Banglore's call-recorder
 * calls in a scratch database:
 *
 *   - root admins only;
 *   - every portal with calls (not the Remote CRM), each one's totals, the sum,
 *     everyone put together by email across portals, the calls merged newest
 *     first and paged; what each portal was asked;
 *   - a portal or a person picked; bad ones refused;
 *   - Banglore: the recorder's calls from its database — direction and result
 *     from the call type, nobody's, a recording, search;
 *   - a portal whose server is from before: "needs updating", the rest stand;
 *   - a recording's link: the portal's own signed path on its server; Banglore's
 *     file over https; none → 404;
 *   - Pending: today's calls per person by default, a period, per portal.
 *
 * Run by calls-check.sh. Scratch databases only.
 */
import mongoose, { Types } from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
for (const [name, value] of [["MONGODB_URI", uri], ["BANGLORE_MONGODB_URI", process.env.BANGLORE_MONGODB_URI ?? ""]] as const) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const STANDIN = `http://127.0.0.1:${process.env.E2E_STANDIN_PORT}`;
const PASSWORD = "CallsE2e!pass1";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 400);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const UAE = 4 * 3_600_000;
const today = new Date(Date.now() + UAE).toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (n: number, h: number) => new Date(Date.parse(`${day(n)}T${String(h).padStart(2, "0")}:00:00Z`) - UAE);

const zero = { calls: 0, outgoing: 0, incoming: 0, connected: 0, missed: 0, notAnswered: 0, talkSeconds: 0, recorded: 0, avgTalkSeconds: 0 };
const totals = (o: Partial<typeof zero>) => ({ ...zero, ...o });
const row = (id: string, startedAt: Date, o: Record<string, unknown> = {}) => ({
  id, startedAt: startedAt.toISOString(), direction: "out", status: "answered", talkSeconds: 60, ringSeconds: 3, number: "971500000001",
  extension: "101", agentName: "", userId: "", userName: "", userEmail: "", person: "-", contact: "Lead", contactKind: "lead", recordings: 0, ...o,
});

async function main() {
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const blrDb = (await mongoose.createConnection(process.env.BANGLORE_MONGODB_URI!).asPromise()).db!;

  /* ── the portals that sync 3CX, as one stand-in ── */
  const SECRETS: Record<string, string> = { delta: "calls-e2e-delta-secret", draw: "calls-e2e-draw-secret", commission: "calls-e2e-commission-secret" };
  const ANSWERS: Record<string, Json> = {
    delta: {
      stats: totals({ calls: 3, outgoing: 2, incoming: 1, connected: 2, missed: 1, talkSeconds: 400, recorded: 1, avgTalkSeconds: 200 }),
      people: [
        { key: "u:a1", userId: "a1", name: "Asha", email: "asha@delta-e2e.test", extension: "", ...totals({ calls: 2, outgoing: 2, connected: 2, talkSeconds: 400, avgTalkSeconds: 200 }) },
        { key: "-", userId: "", name: "Nobody — not answered", email: "", extension: "", ...totals({ calls: 1, incoming: 1, missed: 1 }) },
      ],
      calls: [
        row("d1", at(0, 11), { talkSeconds: 300, person: "u:a1", userName: "Asha", userEmail: "asha@delta-e2e.test", recordings: 1 }),
        row("d2", at(0, 9), { talkSeconds: 100, person: "u:a1", userName: "Asha", userEmail: "asha@delta-e2e.test" }),
        row("d3", at(-2, 9), { direction: "in", status: "missed", talkSeconds: 0 }),
      ],
      total: 3, page: 1, limit: 50,
    },
    commission: {
      stats: totals({ calls: 2, outgoing: 2, connected: 2, talkSeconds: 90, avgTalkSeconds: 45 }),
      people: [{ key: "u:n1", userId: "n1", name: "Nusra", email: "NUSRA@shared-e2e.test", extension: "", ...totals({ calls: 2, outgoing: 2, connected: 2, talkSeconds: 90, avgTalkSeconds: 45 }) }],
      calls: [
        row("t1", at(0, 10), { talkSeconds: 50, person: "u:n1", userName: "Nusra", userEmail: "nusra@shared-e2e.test", contactKind: "student", contact: "Stella · STU-1" }),
        row("t2", at(-1, 10), { talkSeconds: 40, person: "u:n1", userName: "Nusra", userEmail: "nusra@shared-e2e.test", contactKind: "student" }),
      ],
      total: 2, page: 1, limit: 50,
    },
    draw: {
      stats: totals({ calls: 1, outgoing: 1, connected: 1, talkSeconds: 20, avgTalkSeconds: 20 }),
      people: [{ key: "u:n2", userId: "n2", name: "Nusra W", email: "nusra@shared-e2e.test", extension: "", ...totals({ calls: 1, outgoing: 1, connected: 1, talkSeconds: 20, avgTalkSeconds: 20 }) }],
      calls: [row("w1", at(0, 8), { talkSeconds: 20, person: "u:n2", userName: "Nusra W", userEmail: "nusra@shared-e2e.test" })],
      total: 1, page: 1, limit: 50,
    },
  };
  const asked: { portal: string; path: string; query: Record<string, string> }[] = [];
  let drawIsOld = false;
  const { createServer } = await import("node:http");
  const standin = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const portal = url.pathname.split("/")[1] ?? "";
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (String(req.headers["x-portal-secret"] ?? "") !== SECRETS[portal]) return send(401, { success: false, message: "Bad secret" });
    const rest = url.pathname.slice(portal.length + 1);
    asked.push({ portal, path: rest, query: Object.fromEntries(url.searchParams) });
    if (portal === "draw" && drawIsOld) return send(404, { success: false, message: "Route not found" });
    if (rest === "/api/v1/service/calls") {
      const a = ANSWERS[portal];
      return send(200, { success: true, data: url.searchParams.get("list") === "0" ? { ...a, calls: [] } : a });
    }
    const m = rest.match(/^\/api\/v1\/service\/calls\/([a-z0-9]+)\/recording-link$/);
    if (m) {
      if (m[1] === "nothing") return send(404, { success: false, message: "No recording for this call" });
      return send(200, { success: true, data: { path: `/api/v1/calls/3cx/recording?c=${m[1]}&s=signed`, expiresIn: 600 } });
    }
    return send(404, { success: false, message: "Route not found" });
  });
  await new Promise<void>((ok) => standin.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));

  step("Setting up: the registry, two admins, Banglore's recorder calls");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, kind, name, sortOrder] of [
    ["delta", "crm", "Sales CRM", 1], ["banglore", "crm", "Banglore CRM", 2], ["draw", "crm", "Draw CRM", 3], ["remote", "crm", "Remote CRM", 4],
    ["commission", "commission", "Tetra Commission", 5], ["finance-hq", "finance", "Finance HQ", 6],
  ] as [string, string, string, number][]) {
    await Organization.create({ code, kind, name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@calls-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@calls-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const bUser = new Types.ObjectId();
  await blrDb.collection("users").insertOne({ _id: bUser, name: "Bharath", email: "bharath@blr-e2e.test", status: "active" });
  const recordedLog = new Types.ObjectId(), plainLog = new Types.ObjectId();
  await blrDb.collection("calllogs").insertMany([
    { _id: recordedLog, phoneNumber: "+919800000001", contactName: "Ravi", callType: "Outbound", callDirection: "outbound", callDuration: 75, callDate: at(0, 12),
      recordingUrl: "http://api-crm-banglore.example.test/recordings/r1.m4a", initiatedBy: null, agentName: null, source: "call_recorder_app", leadId: new Types.ObjectId() },
    { _id: plainLog, phoneNumber: "+919800000002", contactName: null, callType: "Missed", callDirection: "inbound", callDuration: 0, callDate: at(-1, 12),
      recordingUrl: null, initiatedBy: null, source: "call_recorder_app" },
    { phoneNumber: "+919800000003", contactName: "Kiran", callType: "Outbound", callDirection: "outbound", callDuration: 0, callDate: at(0, 13),
      recordingUrl: null, initiatedBy: bUser, source: "click_to_call" },
    { phoneNumber: "+919800000004", contactName: "Old", callType: "Inbound", callDirection: "inbound", callDuration: 500, callDate: at(-20, 12),
      recordingUrl: null, initiatedBy: null, source: "call_recorder_app" },
  ]);

  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@calls-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@calls-e2e.test")}` };
  const get = async (path: string, headers: Record<string, string> = root): Promise<{ status: number; body: Json }> => {
    const r = await fetch(`${ROOT}${path}`, { headers });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  step("Root admins only");
  check("no session: 401; a member: 403", (await get("/calls", {})).status === 401 && (await get("/calls", member)).status === 403
    && (await get("/pending/calls", member)).status === 403 && (await get(`/calls/delta/${"a".repeat(24)}/recording-link`, member)).status === 403);

  step("Every portal");
  asked.length = 0;
  let r = await get("/calls");
  const d = r.body.data;
  check("the four portals with calls, not the Remote CRM or finance; each one's totals", r.status === 200
    && d.portals.map((p: Json) => p.code).join() === "delta,banglore,draw,commission" && d.portals.every((p: Json) => p.available)
    && d.portals.find((p: Json) => p.code === "delta").stats.calls === 3 && d.portals.find((p: Json) => p.code === "banglore").kind === "recorder", show(d?.portals));
  check("the last 7 days by default, asked of each with page 1 and the window", asked.length === 3
    && asked.every((a) => a.path === "/api/v1/service/calls" && a.query.from === day(-6) && a.query.to === today && a.query.page === "1" && a.query.limit === "50"), show(asked));
  const blr = d.portals.find((p: Json) => p.code === "banglore");
  check("Banglore from its database: 3 in the period (not the one 20 days ago), out 2 / in 1, connected 1, missed 1, not answered 1, 75s, 1 recorded",
    blr.stats.calls === 3 && blr.stats.outgoing === 2 && blr.stats.incoming === 1 && blr.stats.connected === 1 && blr.stats.missed === 1
    && blr.stats.notAnswered === 1 && blr.stats.talkSeconds === 75 && blr.stats.recorded === 1, show(blr.stats));
  check("the sum of all: 9 calls, 585s talk", d.stats.calls === 9 && d.stats.talkSeconds === 585 && d.total === 9, show(d.stats));
  const nusra = d.people.find((p: Json) => p.email === "nusra@shared-e2e.test");
  check("one person across portals, by email: Nusra's TC and Draw calls together", nusra?.calls === 3 && nusra.talkSeconds === 110
    && nusra.portals.map((x: Json) => x.code).sort().join() === "commission,draw", show(nusra));
  check("the recorder's calls nobody made, apart; the click-to-call by Bharath under him", d.people.some((p: Json) => p.key === "banglore:-" && p.calls === 2 && /call recorder/.test(p.name))
    && d.people.some((p: Json) => p.email === "bharath@blr-e2e.test" && p.calls === 1 && p.notAnswered === 1), show(d.people));
  check("every portal's calls merged, newest first", d.calls.length === 9 && d.calls.every((c: Json, i: number) => i === 0 || c.startedAt <= d.calls[i - 1].startedAt)
    && d.calls[0].portal === "banglore" && d.calls[0].contact === "Kiran" && d.calls[1].id === String(recordedLog) && d.calls[2].id === "d1",
    show(d.calls.map((c: Json) => `${c.portal}:${c.id}`)));
  const recRow = d.calls.find((c: Json) => c.id === String(recordedLog));
  check("a recorder call: out, connected, 75s, Ravi, a recording", recRow?.direction === "out" && recRow.status === "answered" && recRow.talkSeconds === 75
    && recRow.contact === "Ravi" && recRow.recordings === 1 && recRow.portalName === "Banglore CRM", show(recRow));
  r = await get("/calls?limit=4&page=2");
  check("page 2 of 4: the next four of the merged list; each asked for its first 8", r.body.data?.calls?.length === 4
    && r.body.data.calls[0].id === d.calls[4].id && asked.slice(-3).every((a) => a.query.limit === "8"), show(r.body.data?.calls?.map((c: Json) => c.id)));
  r = await get("/calls?sort=talk&order=desc");
  check("by talk time, longest first, across portals", r.body.data?.calls?.[0]?.id === "d1" && r.body.data.calls[1].id === "d2", show(r.body.data?.calls?.map((c: Json) => c.id)));

  step("A portal or a person");
  asked.length = 0;
  r = await get("/calls?portal=commission");
  check("one portal: only it asked, only its calls", asked.length === 1 && asked[0]!.portal === "commission" && r.body.data?.calls?.length === 2 && r.body.data.portals.length === 1, show(asked));
  asked.length = 0;
  r = await get(`/calls?person=${encodeURIComponent("delta|u:a1")}`);
  check("a person in a portal: that portal asked for them", asked.length === 1 && asked[0]!.portal === "delta" && asked[0]!.query.person === "u:a1", show(asked));
  r = await get(`/calls?person=${encodeURIComponent(`banglore|u:${bUser}`)}`);
  check("a Banglore person: only theirs", r.body.data?.calls?.length === 1 && r.body.data.stats.calls === 1, show(r.body.data?.stats));
  r = await get(`/calls?person=${encodeURIComponent("banglore|-")}`);
  check("Banglore's nobody: the recorder's two", r.body.data?.stats?.calls === 2);
  r = await get("/calls?portal=banglore&search=ravi");
  check("search Banglore by name", r.body.data?.calls?.length === 1 && r.body.data.calls[0].contact === "Ravi");
  r = await get("/calls?portal=banglore&direction=in");
  check("…by direction: the missed one", r.body.data?.calls?.length === 1 && r.body.data.calls[0].status === "missed");
  r = await get(`/calls?portal=banglore&from=${day(-30)}&to=${today}`);
  check("…30 days back: the old one too", r.body.data?.stats?.calls === 4);
  check("a bad portal, person or date: 400", (await get("/calls?portal=nope")).status === 400 && (await get("/calls?person=nope")).status === 400
    && (await get("/calls?from=yesterday")).status === 400 && (await get(`/calls?from=${today}&to=${day(-1)}`)).status === 400);

  step("A portal on an older server");
  drawIsOld = true;
  r = await get("/calls");
  const draw = r.body.data?.portals?.find((p: Json) => p.code === "draw");
  check("Draw: needs updating, the rest stand", r.status === 200 && draw?.available === false && /needs updating/.test(draw.error ?? "")
    && r.body.data.portals.filter((p: Json) => p.available).length === 3 && r.body.data.stats.calls === 8, show(draw));
  drawIsOld = false;

  step("A recording's link");
  r = await get(`/calls/delta/${"a".repeat(24)}/recording-link?index=0`);
  check("from the portal that has it: its signed path, on its server", r.status === 200 && r.body.data?.url === `${STANDIN}/delta/api/v1/calls/3cx/recording?c=${"a".repeat(24)}&s=signed`, show(r.body));
  r = await get(`/calls/banglore/${recordedLog}/recording-link`);
  check("Banglore's file, over https", r.status === 200 && r.body.data?.url === "https://api-crm-banglore.example.test/recordings/r1.m4a", show(r.body));
  check("none: 404 (Banglore's, and when the portal has none)", (await get(`/calls/banglore/${plainLog}/recording-link`)).status === 404);
  check("an unknown portal, a bad id: 400", (await get(`/calls/remote/${"a".repeat(24)}/recording-link`)).status === 400 && (await get("/calls/delta/nope/recording-link")).status === 400);

  step("Pending: each person's calls");
  asked.length = 0;
  r = await get("/pending/calls");
  check("today by default, totals only (list=0)", r.status === 200 && r.body.data?.period?.from === today && r.body.data.period.to === today
    && asked.every((a) => a.query.list === "0" && a.query.from === today), show(asked));
  check("everyone by email across portals, each portal's summary", r.body.data.people.some((p: Json) => p.email === "nusra@shared-e2e.test" && p.portals.length === 2)
    && r.body.data.portals.length === 4, show(r.body.data?.people));
  r = await get(`/pending/calls?from=${day(-6)}&to=${today}`);
  check("a period", r.body.data?.period?.from === day(-6));
}

main()
  .then(async () => {
    console.log(`\n${checks - failures}/${checks} checks passed`);
    await mongoose.disconnect();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
