/**
 * Moving leads between the sales CRMs through Root (the user, 2026-11-19), on a scratch database with stand-in CRMs:
 *
 *   Who       only a sales CRM's own secret (Sales, Draw, Remote) — none, a wrong one, Banglore's → refused
 *   Targets   the other two CRMs, their active teams and active people (leaders first); a CRM not set up says so
 *   Moving    to the other CRM's door with its sheet key: what was asked, and where from (the secret, never the body);
 *             never to itself or one there isn't; a row per lead it took; one it didn't take, with its reason; the CRM
 *             refusing the lot (400) or down → an error, no rows
 *   Undo      only the CRM it left, within 24 hours, once; the other CRM gives it back first (refuses → 409, no change)
 *
 * Run by crm-lead-moves-check.sh. Scratch database only.
 */
import { Types } from "mongoose";

const MONGO = process.env.MONGO ?? "";
const uri = process.env.MONGODB_URI ?? "";
if (!/127\.0\.0\.1|localhost/.test(uri) || !/scratch/i.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch database, got "${uri}"`);
  process.exit(1);
}
let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail !== "" ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}\x1b[0m`); }
}
const section = (s: string) => console.log(`\n${s}`);

/* ── Stand-in CRMs ────────────────────────────────────────────────────────── */
const calls: { crm: string; path: string; key: string; body: Record<string, unknown> }[] = [];
let drawMode: "ok" | "refuse" | "down" | "closed" = "ok";
function crm(code: string) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      calls.push({ crm: code, path: url.pathname, key: req.headers.get("x-api-key") ?? "", body });
      if (code === "draw" && drawMode === "down") return new Response("boom", { status: 502 });
      if (url.pathname === "/api/v1/sheets/lead-moves") {
        if (code === "draw" && drawMode === "refuse") return Response.json({ success: false, message: "That person isn't in that team" }, { status: 400 });
        const leads = (body.leads as { name: string; phone: string }[]) ?? [];
        return Response.json({ success: true, message: "ok", data: { results: leads.map((l, index) =>
          l.name === "Nope" ? { index, status: "invalid", reason: "No phone number" }
          : l.name === "Known" ? { index, status: "repeat", leadId: String(new Types.ObjectId()), holder: "Tess" }
          : { index, status: "created", leadId: String(new Types.ObjectId()), holder: "Dee", teamName: "Draw A", personName: "Dee" }) } });
      }
      if (url.pathname === "/api/v1/sheets/lead-moves/send") {
        const ids = (body.leadIds as string[]) ?? [];
        return Response.json({ success: true, message: "ok", data: { moved: ids.slice(0, 1).map((id) => ({ leadId: id, name: "Lena", moveId: "m", holder: "Dee", outcome: "created" })), refused: ids.slice(1).map((id) => ({ leadId: id, name: "Closed one", reason: "Closed — a closed lead stays" })) } });
      }
      if (url.pathname === "/api/v1/sheets/lead-moves/undo") {
        if (drawMode === "closed") return Response.json({ success: false, message: "Draw CRM: Lena has been closed there — it can't be taken back" }, { status: 409 });
        return Response.json({ success: true, message: "ok", data: { leadId: body.leadId } });
      }
      if (url.pathname === "/api/v1/sheets/lead-moves/take-back") {
        if (drawMode === "closed") return Response.json({ success: false, message: "L has been closed here — it can't be taken back" }, { status: 409 });
        return Response.json({ success: true, message: "ok", data: { kept: false } });
      }
      return Response.json({ success: false, message: "nope" }, { status: 404 });
    },
  });
}
const draw = crm("draw"), delta = crm("delta");

Object.assign(process.env, {
  NODE_ENV: "test", JWT_SECRET: "crm-lead-moves-check-access-0123456789", JWT_REFRESH_SECRET: "crm-lead-moves-check-refresh-0123456789",
  SMTP_HOST: "", HRMS_API_URL: "", TRAFFIC_WORKER: "false",
  DELTA_API_URL: `http://127.0.0.1:${delta.port}`, DELTA_SHEETS_API_KEY: "delta-key", DELTA_SSO_SECRET: "delta-secret", DELTA_MONGODB_URI: `${MONGO}/delta-crm-scratch`,
  DRAW_API_URL: `http://127.0.0.1:${draw.port}/api/v1`, DRAW_SHEETS_API_KEY: "draw-key", DRAW_SSO_SECRET: "draw-secret", DRAW_MONGODB_URI: `${MONGO}/draw-crm-scratch`,
  REMOTE_API_URL: "", REMOTE_SHEETS_API_KEY: "", REMOTE_SSO_SECRET: "remote-secret", REMOTE_MONGODB_URI: `${MONGO}/remote-crm-scratch`,
  BANGLORE_SSO_SECRET: "banglore-secret", BANGLORE_MONGODB_URI: "",
});
const mongoose = (await import("mongoose")).default;
await mongoose.connect(uri);
await mongoose.connection.dropDatabase();
const db = mongoose.connection.db!;
for (const [code, name] of [["delta", "Delta"], ["draw", "Delta Draw"], ["remote", "Remote CRM"], ["banglore", "Banglore"]]) {
  await db.collection("organizations").insertOne({ code, name, kind: "crm", isActive: true, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, sortOrder: 1 });
}
// The Draw CRM's database: two teams (one inactive), people (one inactive).
const drawDb = mongoose.connection.useDb("draw-crm-scratch").db!;
await drawDb.dropDatabase();
const p = { dee: new Types.ObjectId(), ali: new Types.ObjectId(), old: new Types.ObjectId(), tess: new Types.ObjectId() };
await drawDb.collection("users").insertMany([
  { _id: p.dee, name: "Dee", status: "active" }, { _id: p.ali, name: "Ali", status: "active" },
  { _id: p.old, name: "Old", status: "inactive" }, { _id: p.tess, name: "Tess", status: "active" },
]);
const teamA = new Types.ObjectId();
await drawDb.collection("teams").insertMany([
  { _id: teamA, name: "Draw A", leaders: [p.tess], members: [p.dee, p.ali, p.old], status: "active" },
  { _id: new Types.ObjectId(), name: "Gone", leaders: [p.dee], members: [], status: "inactive" },
]);
const deltaDb = mongoose.connection.useDb("delta-crm-scratch").db!;
await deltaDb.dropDatabase();
// Leads to find from Root's page: the same number in two CRMs (written differently), one closed.
const lena = new Types.ObjectId(), lenaD = new Types.ObjectId(), shut = new Types.ObjectId();
await drawDb.collection("leads").insertMany([
  { _id: lena, name: "Lena Find", phone: "+971 50-765 4321", status: "followup", assignedTo: p.dee, team: teamA, createdAt: new Date("2026-11-10") },
  { _id: shut, name: "Shut Case", phone: "+971509990000", status: "closed", assignedTo: p.ali, team: teamA, createdAt: new Date("2026-11-09") },
]);
await deltaDb.collection("leads").insertOne({ _id: lenaD, name: "Lena Again", phone: "00971507654321", status: "new", createdAt: new Date("2026-11-12") });

const express = (await import("express")).default;
const routes = (await import("../src/routes/index.js")).default;
const { errorHandler } = await import("../src/middleware/errorHandler.js");
const { CrmLeadMove } = await import("../src/models/CrmLeadMove.js");
const { signAccessToken } = await import("../src/utils/jwt.js");
const admins: Record<string, string> = {};
for (const [who, role, trafficAccess] of [["root", "root_admin", "none"], ["viewer", "member", "view"], ["nobody", "member", "none"]]) {
  const _id = new Types.ObjectId();
  await db.collection("adminusers").insertOne({ _id, name: who, email: `${who}@test.local`, password: "x", role, status: "active", trafficAccess, pendingAccess: [], reportAccess: [] });
  admins[who] = signAccessToken({ adminId: String(_id), email: `${who}@test.local`, role } as never);
}
const app = express();
app.use(express.json());
app.use("/api/v1", routes);
app.use(errorHandler);
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
async function api<T>(method: string, path: string, secret: string | null, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/service${path}`, {
    method, headers: { "content-type": "application/json", ...(secret ? { "x-org-secret": secret } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { success: boolean; message: string; data: T } };
}
const lead = (name: string, i: number) => ({ fromLeadId: `r${i}`, name, phone: `+97150${1000000 + i}`, ownerName: "Ann", status: "followup", notes: [{ content: "hi" }] });

try {
  section("Who may ask");
  check("no secret → 401", (await api("GET", "/lead-moves/targets", null)).status === 401);
  check("a wrong secret → 401", (await api("GET", "/lead-moves/targets", "nope")).status === 401);
  check("Banglore's secret → 403 (only Sales, Draw, Remote)", (await api("GET", "/lead-moves/targets", "banglore-secret")).status === 403);

  section("Where leads can go");
  type Target = { code: string; name: string; ready: boolean; missing: string[]; error?: string; teams: { id: string; name: string; people: { id: string; name: string; leader: boolean }[] }[] };
  const t = await api<Target[]>("GET", "/lead-moves/targets", "remote-secret");
  const tDraw = t.body.data?.find((x) => x.code === "draw");
  const tDelta = t.body.data?.find((x) => x.code === "delta");
  check("Remote sees the Sales and Draw CRMs, not itself", t.status === 200 && t.body.data.length === 2 && !!tDraw && !!tDelta && tDelta.name === "Sales CRM", t.body);
  check("…Draw's active teams only", tDraw?.teams.length === 1 && tDraw.teams[0].name === "Draw A", tDraw);
  check("…its active people, the leader first", JSON.stringify(tDraw?.teams[0].people.map((x) => [x.name, x.leader])) === JSON.stringify([["Tess", true], ["Ali", false], ["Dee", false]]), tDraw?.teams[0]);
  check("…ready (address and key set)", tDraw?.ready === true);
  const tr = await api<Target[]>("GET", "/lead-moves/targets", "draw-secret");
  const tRemote = tr.body.data?.find((x) => x.code === "remote");
  check("Draw sees Remote — not ready, naming what's missing", tRemote?.ready === false && tRemote.missing.includes("REMOTE_API_URL") && tRemote.missing.includes("REMOTE_SHEETS_API_KEY"), tRemote);

  section("Moving");
  const body = { to: "draw", mode: "person", teamId: String(teamA), userId: String(p.dee), byName: "Tina", leads: [lead("L1", 1), lead("Nope", 2), lead("Known", 3)] };
  check("to itself → 400", (await api("POST", "/lead-moves", "remote-secret", { ...body, to: "remote" })).status === 400);
  check("to a CRM there isn't → 400", (await api("POST", "/lead-moves", "remote-secret", { ...body, to: "banglore" })).status === 400);
  check("a person move without a person → 400", (await api("POST", "/lead-moves", "remote-secret", { ...body, userId: null })).status === 400);
  check("no leads → 400", (await api("POST", "/lead-moves", "remote-secret", { ...body, leads: [] })).status === 400);
  calls.length = 0;
  const m = await api<{ fromLeadId: string; moved: boolean; moveId?: string; outcome?: string; holder?: string; reason?: string }[]>("POST", "/lead-moves", "remote-secret", { ...body, from: "delta" });
  check("moved: answered lead by lead", m.status === 201 && m.body.data.length === 3, m.body);
  const [r1, r2, r3] = m.body.data ?? [];
  check("…L1 moved, a new lead there, with Dee", r1?.moved === true && r1.outcome === "created" && r1.holder === "Dee" && !!r1.moveId);
  check("…one Draw didn't take: not moved, its reason", r2?.moved === false && r2.reason === "No phone number");
  check("…a number Draw had: moved as a repeat", r3?.moved === true && r3.outcome === "repeat" && r3.holder === "Tess");
  const c = calls.find((x) => x.path === "/api/v1/sheets/lead-moves");
  check("Draw was asked at its door (the /api/v1 in its address not doubled), with its sheet key", c?.crm === "draw" && c.key === "draw-key", calls);
  check("…from Remote (the secret, not the body's \"from\")", c?.body.from === "remote" && c.body.fromName === "Remote CRM", c?.body);
  check("…with what was picked and the leads", c?.body.mode === "person" && c?.body.userId === String(p.dee) && (c?.body.leads as unknown[])?.length === 3 && c?.body.byName === "Tina");
  const rows = await CrmLeadMove.find().lean();
  check("a row for each lead it took (2)", rows.length === 2 && rows.every((r) => r.from === "remote" && r.to === "draw" && r.byName === "Tina" && r.ownerName === "Ann" && r.status === "followup"), rows);
  drawMode = "refuse";
  const bad = await api("POST", "/lead-moves", "remote-secret", body);
  check("Draw refusing the lot → 400 with its reason, no rows", bad.status === 400 && /isn't in that team/.test(bad.body.message) && (await CrmLeadMove.countDocuments()) === 2, bad.body);
  drawMode = "down";
  const down = await api("POST", "/lead-moves", "remote-secret", body);
  check("Draw down → 502, no rows", down.status === 502 && (await CrmLeadMove.countDocuments()) === 2, down.body);
  drawMode = "ok";
  const sp = await api<{ moved: boolean }[]>("POST", "/lead-moves", "draw-secret", { to: "delta", mode: "split", byName: "Dee", leads: [lead("L9", 9)] });
  check("Draw → Sales, the Sales CRM's own split", sp.status === 201 && sp.body.data[0].moved && calls.at(-1)?.crm === "delta" && calls.at(-1)?.key === "delta-key", sp.body);
  check("to a CRM not set up → 502 naming what's missing", /REMOTE_API_URL/.test((await api("POST", "/lead-moves", "draw-secret", { to: "remote", mode: "split", leads: [lead("L8", 8)] })).body.message));

  section("Moves list");
  const l = await api<{ from: string; to: string }[]>("GET", "/lead-moves", "draw-secret");
  check("Draw sees the moves to and from it (3)", l.body.data?.length === 3 && l.body.data.every((x) => x.from === "draw" || x.to === "draw"), l.body);

  section("Undo");
  const id = r1!.moveId!;
  check("another CRM can't undo Remote's move → 404", (await api("POST", `/lead-moves/${id}/undo`, "draw-secret", {})).status === 404);
  drawMode = "closed";
  const u0 = await api("POST", `/lead-moves/${id}/undo`, "remote-secret", { byName: "Tina" });
  check("Draw refuses (closed there) → 409, not undone", u0.status === 409 && /closed/.test(u0.body.message) && !(await CrmLeadMove.findById(id))?.undoneAt, u0.body);
  drawMode = "ok";
  calls.length = 0;
  const u1 = await api<{ undoneAt: string }>("POST", `/lead-moves/${id}/undo`, "remote-secret", { byName: "Tina" });
  check("Remote undoes it: Draw gives it back first", u1.status === 200 && calls[0]?.path === "/api/v1/sheets/lead-moves/take-back" && calls[0].body.leadId === rows.find((r) => String(r._id) === id)?.toLeadId && calls[0].body.fromLeadId === "r1", { u1: u1.body, calls });
  check("…the row says undone, by whom", !!(await CrmLeadMove.findById(id))?.undoneAt && (await CrmLeadMove.findById(id))?.undoneBy === "Tina");
  check("not twice (409)", (await api("POST", `/lead-moves/${id}/undo`, "remote-secret", {})).status === 409);
  const other = r3!.moveId!;
  await CrmLeadMove.collection.updateOne({ _id: new Types.ObjectId(other) }, { $set: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
  check("after 24 hours (409)", (await api("POST", `/lead-moves/${other}/undo`, "remote-secret", {})).status === 409);

  section("Root's Lead moves page");
  async function page<T>(method: string, path: string, who: string, body?: unknown) {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/traffic${path}`, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${admins[who]}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { success: boolean; message: string; data: T } };
  }
  type Found = { leads: { crm: string; leadId: string; name: string; status: string; ownerName: string; teamName: string; movable: boolean }[]; unreadable: string[] };
  check("someone without lead-traffic access → 403", (await page("GET", "/crm-moves", "nobody")).status === 403);
  const f1 = await page<Found>("GET", "/crm-moves/find?q=0507654321", "viewer");
  check("by phone (last 9, however it's written): in Draw and in Sales", f1.status === 200 && f1.body.data.leads.length === 2 && f1.body.data.leads.some((l) => l.crm === "draw" && l.leadId === String(lena)) && f1.body.data.leads.some((l) => l.crm === "delta"), f1.body);
  const fl = f1.body.data?.leads.find((l) => l.crm === "draw");
  check("…with who has it and their team", fl?.ownerName === "Dee" && fl.teamName === "Draw A" && fl.movable === true, fl);
  const f2 = await page<Found>("GET", "/crm-moves/find?q=shut", "viewer");
  check("by name; a closed one can't move", f2.body.data?.leads.length === 1 && f2.body.data.leads[0].movable === false, f2.body);
  check("too short → 400", (await page("GET", "/crm-moves/find?q=ab", "viewer")).status === 400);
  check("…a search with regex in it is just text", (await page<Found>("GET", "/crm-moves/find?q=.*.*", "viewer")).body.data?.leads.length === 0);
  check("view access can't move (403)", (await page("POST", "/crm-moves", "viewer", { from: "draw", to: "delta", mode: "split", leadIds: [String(lena)] })).status === 403);
  check("…nor list another CRM's teams (403)", (await page("GET", "/crm-moves/targets/draw", "viewer")).status === 403);
  const tg = await page<{ code: string }[]>("GET", "/crm-moves/targets/draw", "root");
  check("a root admin: where Draw's leads can go (Sales, Remote)", tg.body.data?.map((x) => x.code).sort().join() === "delta,remote", tg.body);
  check("to the same CRM → 400", (await page("POST", "/crm-moves", "root", { from: "draw", to: "draw", mode: "split", leadIds: [String(lena)] })).status === 400);
  calls.length = 0;
  const mv = await page<{ moved: unknown[]; refused: unknown[] }>("POST", "/crm-moves", "root", { from: "draw", to: "delta", mode: "person", teamId: "t", userId: "u", leadIds: [String(lena), String(shut)] });
  const sendCall = calls.find((c) => c.path === "/api/v1/sheets/lead-moves/send");
  check("a root admin moves: Draw is asked to move them (its sheet key)", mv.status === 200 && sendCall?.crm === "draw" && sendCall.key === "draw-key", { mv: mv.body, calls });
  check("…with what was picked, named after the root admin", sendCall?.body.to === "delta" && sendCall.body.mode === "person" && sendCall.body.teamId === "t" && sendCall.body.userId === "u" && sendCall.body.byName === "root" && (sendCall.body.leadIds as string[]).length === 2, sendCall?.body);
  check("…Draw's answer comes back (1 moved, 1 not, why)", mv.body.data?.moved?.length === 1 && mv.body.data.refused.length === 1);
  check("…audited", (await db.collection("auditlogs").findOne({ action: "crm_leads_moved" }))?.detail?.includes("1 moved draw → delta") === true);
  type MoveRow = { id: string; from: string; fromName: string; toName: string; canUndo: boolean; undoneAt: string | null };
  const ls = await page<MoveRow[]>("GET", "/crm-moves", "viewer");
  check("every move, with the CRMs' names and whether Undo is open", ls.status === 200 && ls.body.data.length === 3 && ls.body.data.every((r) => !!r.fromName && !!r.toName) && ls.body.data.some((r) => r.canUndo) && ls.body.data.some((r) => !r.canUndo), ls.body);
  const open = (await CrmLeadMove.findOne({ undoneAt: null, createdAt: { $gt: new Date(Date.now() - 3_600_000) } }).lean())!;
  drawMode = "closed";
  await CrmLeadMove.collection.updateOne({ _id: open._id }, { $set: { from: "draw", to: "delta" } });
  const ux = await page("POST", `/crm-moves/${open._id}/undo`, "root");
  check("Undo: the CRM it left refuses (closed there) → 409, not undone", ux.status === 409 && !(await CrmLeadMove.findById(open._id))?.undoneAt, ux.body);
  drawMode = "ok";
  calls.length = 0;
  const uy = await page("POST", `/crm-moves/${open._id}/undo`, "root");
  check("Undo: the CRM it left is asked to undo it (by the lead's id there)", uy.status === 200 && calls[0]?.path === "/api/v1/sheets/lead-moves/undo" && calls[0].crm === "draw" && calls[0].body.leadId === open.fromLeadId && calls[0].body.byName === "root", { uy: uy.body, calls });
  check("…audited", !!(await db.collection("auditlogs").findOne({ action: "crm_lead_move_undone" })));
  check("view access can't undo (403)", (await page("POST", `/crm-moves/${open._id}/undo`, "viewer")).status === 403);
} finally {
  server.close();
  draw.stop(true); delta.stop(true);
  await mongoose.disconnect();
}
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
