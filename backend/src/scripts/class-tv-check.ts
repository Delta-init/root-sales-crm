/**
 * The Class TV end to end (services/classTvService.ts, routes/classTvRoutes.ts, routes/publicRoutes.ts):
 *
 *   Case 1  happy path   an academy's classes today, each once with everybody who teaches it, with its course, time,
 *                        place and status; the other academy's on its own board; the open answer with no email
 *   Case 2  recordings   a mentor's line and the two common ones: kept, served as they came, a new one at a new
 *                        address, one common line serving both moments, removed
 *   Case 3  edges        the LMS asked once a minute for each academy however many screens; a recording shows without
 *                        asking it again; a class outside the day left out; an LMS from before it said where a class
 *                        is held (no place, the class its first mentor's academy's); the academy's own day
 *   Case 4  errors       the LMS down: the open answer says so plainly, a root admin sees its words; today's board
 *                        kept through a failure; not a WAV, too big, no such line, no such recording
 *   Case 5  permission   the recordings: no session 401, not a root admin 403; the board and a recording open
 *   Case 6  photos       each mentor's face from the HRMS (its signed work-modes): by their email, else by their name;
 *                        somebody the HRMS has no photo of gets none; asked once for the same people however many
 *                        screens; the HRMS down: the board carries on, with the faces it already had
 *
 * Run through scripts/class-tv-check.sh. Scratch database on 127.0.0.1 only; the LMS and the HRMS are a stand-in.
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
const PASSWORD = "ClassTvE2e!pass1";
const SECRET = "class-tv-e2e-lms";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 600);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** A short WAV: the header a browser writes, then `samples` of 16-bit silence with a marker in them. */
function wav(samples: number, mark = 1): Buffer {
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(((i * mark) % 200) - 100, i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii"); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8, "ascii"); head.write("fmt ", 12, "ascii");
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(22050, 24); head.writeUInt32LE(44100, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36, "ascii"); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const dataUrl = (b: Buffer) => `data:audio/wav;base64,${b.toString("base64")}`;

// ── The stand-in: the LMS's /api/v1/service/mentors ──────────────────────────
// Each academy's classes hang off the middle of its own day, so the check reads the same at any hour.
const noonOf = (offsetMin: number) => {
  const day = new Date(Date.now() + offsetMin * 60_000).toISOString().slice(0, 10);
  return Date.parse(`${day}T12:00:00.000Z`) - offsetMin * 60_000;
};
const DXB = noonOf(240), BLR = noonOf(330);
const at = (base: number, mins: number) => new Date(base + mins * 60_000).toISOString();
const ASHA = "64a0000000000000000000a1", BEN = "64a0000000000000000000b2", RAVI = "64a0000000000000000000c3", ZED = "64a0000000000000000000d4";
const DUBAI = { id: "64a000000000000000000d0b", name: "Dubai Academy" }, BANGALORE = { id: "64a000000000000000000b1r".replace("r", "0"), name: "Bangalore Academy" };
const cls = (id: string, title: string, startsAt: string, extra: Json = {}) => ({ id, title, startsAt, durationMins: 60, status: "scheduled", booked: 3, capacity: 30, mine: true, courseId: "c", course: "Forex Mastery", moduleId: "m", module: "Module 3", online: true, place: "", academy: "Dubai Academy", ...extra });
const C1 = cls("c1", "Forex A", at(DXB, 60), { place: "Pod 6" });
const C2 = cls("c2", "Workshop", at(DXB, -30), { online: false, place: "Class Room 1", status: "live", durationMins: 90, course: "Digital Marketing", module: "" });
const C3 = cls("c3", "Called off", at(DXB, 180), { status: "cancelled" });
const C4 = cls("c4", "Bangalore live", at(BLR, 30), { academy: "Bangalore Academy", place: "Room B" });
const C5 = cls("c5", "Lent to Bangalore", at(BLR, 120), { academy: "Bangalore Academy" });
const C6 = cls("c6", "Tomorrow's", at(DXB, 30 * 60));
let oldLms = false;
const strip = (c: Json) => { if (!oldLms) return c; const { online: _o, place: _p, academy: _a, ...rest } = c; return rest; };
const mentors = () => [
  { id: ASHA, name: "Asha", email: "Asha@lms-e2e.test", shared: false, academy: DUBAI, slots: [], classes: [C1, C2, C6].map(strip), meetings: [{ id: "m1", title: "With a student", startsAt: at(DXB, 0) }] },
  { id: BEN, name: "Ben", email: "ben@lms-e2e.test", shared: false, academy: DUBAI, slots: [], classes: [C2, C3, C5].map(strip), meetings: [] },
  { id: RAVI, name: "Ravi", email: "ravi@lms-e2e.test", shared: false, academy: BANGALORE, slots: [], classes: [C4].map(strip), meetings: [] },
  { id: ZED, name: "Zed", email: "zed@lms-e2e.test", shared: false, academy: DUBAI, slots: [], classes: [], meetings: [] },
];
const hits: { query: URLSearchParams; secret: boolean }[] = [];
let down = false;
// HRMS's work-modes, as it answers: one row for each person asked, in the order asked. It knows Asha by her email, Ben
// only by his name (his HRMS email is another), has no photo of Zed, and has never heard of Ravi's email or name.
const hrmsHits: { people: { email: string; name?: string }[]; signed: boolean }[] = [];
let hrmsDown = false;
const PHOTO = (who: string) => `https://hrms-e2e.test/photos/${who}.jpg?sig=abc`;
const hrmsRow = (p: { email: string; name?: string }) => {
  const email = p.email.toLowerCase();
  const photoUrl = email === "asha@lms-e2e.test" ? PHOTO("asha") : p.name === "Ben" ? PHOTO("ben") : null;
  return { email: p.email, matchedBy: email === "asha@lms-e2e.test" ? "email" : p.name === "Ben" ? "name" : null, hrmsEmail: null, hrmsName: p.name ?? null, workMode: "office", location: "Dubai", status: "active", designation: "Mentor", photoUrl };
};
const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/hrms/")) {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const path = url.pathname.slice("/hrms".length) + url.search;
      const ts = String(req.headers["x-delta-timestamp"] ?? ""), nonce = String(req.headers["x-delta-nonce"] ?? "");
      const canonical = [req.method, path, ts, nonce, crypto.createHash("sha256").update(raw).digest("hex")].join("\n");
      const want = crypto.createHmac("sha256", "class-tv-e2e-hrms-signing").update(canonical).digest("hex");
      const signed = req.headers["x-delta-signature"] === want && req.headers["x-delta-client"] === "class-tv-e2e";
      const people: { email: string; name?: string }[] = (() => { try { return JSON.parse(raw).people ?? []; } catch { return []; } })();
      hrmsHits.push({ people, signed });
      if (!signed) return send(401, { success: false, message: "Bad signature" });
      if (req.method !== "POST" || path !== "/api/v1/integrations/directory/work-modes") return send(404, { success: false, message: "Route not found" });
      if (hrmsDown) return send(500, { success: false, message: "HRMS exploded at 10.0.0.6" });
      send(200, { success: true, data: people.map(hrmsRow) });
    });
    return;
  }
  if (url.pathname !== "/lms/api/v1/service/mentors") return send(404, { success: false, message: "Route not found" });
  hits.push({ query: url.searchParams, secret: req.headers["x-portal-secret"] === SECRET });
  if (req.headers["x-portal-secret"] !== SECRET) return send(401, { success: false, message: "Bad secret" });
  if (down) return send(500, { success: false, message: "LMS database exploded at 10.0.0.5" });
  send(200, { success: true, data: { timezone: "Asia/Dubai", from: url.searchParams.get("from"), to: url.searchParams.get("to"), mentors: mentors() } });
});
await new Promise<void>((ok) => stand.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));
const dayHits = (offsetMin: number) => hits.filter((h) => Date.parse(h.query.get("from") ?? "") === noonOf(offsetMin) - 12 * 3_600_000);

async function main() {
  mongoose.set("autoIndex", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();

  step("Setting up: the registry and two admins");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  await Organization.create({ code: "lms", kind: "lms", name: "LMS", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 6, accent: "#7c3aed" });
  await AdminUser.create({ name: "Root E2E", email: "root@class-tv-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@class-tv-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@class-tv-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@class-tv-e2e.test")}` };

  step("Case 4 — the LMS down before anybody has a board (Bangalore's)");
  down = true;
  const blrAskedAt = Date.now();
  let r = await call("GET", "/public/class-tv?academy=bangalore");
  check("the open answer: an error, said plainly, no classes", r.status === 200 && r.body?.data?.status === "error" && r.body.data.error === "Today's classes can't be reached right now." && r.body.data.classes.length === 0, show(r.body));
  r = await call("GET", "/class-tv?academy=bangalore", root);
  check("a root admin sees the LMS's own words", /LMS would not list today's classes: LMS database exploded/.test(r.body?.data?.error ?? ""), show(r.body?.data?.error));
  check("…and the LMS wasn't asked twice for it inside a minute", dayHits(330).length === 1, show(dayHits(330).length));
  down = false;

  step("Case 1 — happy path: Dubai's classes today");
  const dxbAskedAt = Date.now();
  r = await call("GET", "/public/class-tv?academy=dubai");
  const d = r.body?.data ?? {};
  check("200, Dubai's board for its own day", r.status === 200 && d.status === "ok" && d.academy === "dubai" && d.academyName === "Dubai" && d.timezone === "Asia/Dubai"
    && d.day === new Date(Date.now() + 240 * 60_000).toISOString().slice(0, 10) && d.leadMinutes === 5 && !Number.isNaN(Date.parse(d.serverTime)), show({ ...d, classes: undefined }));
  check("its three classes in time order — not Bangalore's, not the one lent to Bangalore, not tomorrow's", (d.classes ?? []).map((c: Json) => c.id).join() === "c2,c1,c3", show((d.classes ?? []).map((c: Json) => c.id)));
  const c1 = (d.classes ?? []).find((c: Json) => c.id === "c1"), c2 = (d.classes ?? []).find((c: Json) => c.id === "c2");
  same("a class: course, module, time, place", (({ title, course, module, startsAt, endsAt, durationMins, status, online, place }) => ({ title, course, module, startsAt, endsAt, durationMins, status, online, place }))(c1 ?? {}),
    { title: "Forex A", course: "Forex Mastery", module: "Module 3", startsAt: C1.startsAt, endsAt: at(DXB, 120), durationMins: 60, status: "scheduled", online: true, place: "Pod 6" });
  same("…its mentor, by name, with her HRMS photo — no recording yet", c1?.mentors, [{ id: ASHA, name: "Asha", photoUrl: PHOTO("asha"), voice: null }]);
  check("a co-mentored class once, with both who teach it; in person, in its room, on now", c2?.mentors?.map((m: Json) => m.name).join() === "Asha,Ben" && c2.online === false && c2.place === "Class Room 1" && c2.status === "live" && c2.endsAt === at(DXB, 60), show(c2));
  check("a cancelled class says so", (d.classes ?? []).find((c: Json) => c.id === "c3")?.status === "cancelled");
  check("no email and no meeting anywhere in the open answer", !/@/.test(JSON.stringify(d)) && !/With a student/.test(JSON.stringify(d)), JSON.stringify(d).slice(0, 300));
  check("the LMS asked for that day, both academies' mentors, with the secret", (() => {
    const h = dayHits(240)[0];
    return !!h && h.secret && h.query.get("allAcademies") === "1" && h.query.get("remoteOrgId") === "64a000000000000000000d0b" && Date.parse(h.query.get("to") ?? "") === noonOf(240) + 12 * 3_600_000 - 1;
  })(), show(dayHits(240).map((h) => h.query.toString())));
  check("no common line yet", d.voices?.soon === null && d.voices?.now === null, show(d.voices));

  step("Case 6 — the mentors' photos, from the HRMS");
  check("Ben's too, found by his name; both faces on the class they teach together", c2?.mentors?.map((m: Json) => m.photoUrl).join() === `${PHOTO("asha")},${PHOTO("ben")}`, show(c2?.mentors));
  check("the HRMS asked once, signed, for the mentors teaching in Dubai today — by email and name", hrmsHits.length === 1 && hrmsHits[0]!.signed
    && hrmsHits[0]!.people.map((p) => `${p.email}:${p.name}`).sort().join() === "asha@lms-e2e.test:Asha,ben@lms-e2e.test:Ben", show(hrmsHits));
  check("…nobody asked about who has no class today (Zed), and no email in the photo links", !/zed/i.test(JSON.stringify(hrmsHits)) && !/@/.test(JSON.stringify(d)));

  step("Case 5 — the recordings are root admins'; the board is open");
  for (const [method, path, body] of [["GET", "/class-tv", undefined], ["GET", "/class-tv/voices", undefined], ["PUT", `/class-tv/voices/mentor:${ASHA}`, {}], ["DELETE", `/class-tv/voices/mentor:${ASHA}`, undefined]] as [string, string, unknown][]) {
    check(`${method} ${path.replace(ASHA, ":id")}: no session 401, not a root admin 403`, (await call(method, path, {}, body)).status === 401 && (await call(method, path, member, body)).status === 403);
  }

  step("Case 2 — the recordings");
  const first = wav(4000);
  r = await call("PUT", `/class-tv/voices/mentor:${ASHA}`, root, { audio: dataUrl(first), seconds: 0.18, name: "Asha" });
  check("Asha's line recorded", r.status === 200 && /^\/public\/class-tv\/voice\/[a-f\d]{24}\?v=1$/.test(r.body?.data?.url ?? "") && r.body.data.bytes === first.length && r.body.data.recordedBy === "root@class-tv-e2e.test", show(r.body));
  const url1: string = r.body?.data?.url ?? "";
  let got = await fetch(`${ROOT}${url1}`);
  let bytes = Buffer.from(await got.arrayBuffer());
  check("…served as it came: a WAV, to be kept by the screen", got.status === 200 && got.headers.get("content-type") === "audio/wav" && bytes.equals(first) && /immutable/.test(got.headers.get("cache-control") ?? "") && got.headers.get("cross-origin-resource-policy") === "cross-origin", `${got.status} ${got.headers.get("content-type")} ${bytes.length}`);
  r = await call("GET", "/public/class-tv?academy=dubai");
  const withVoice = (r.body?.data?.classes ?? []).flatMap((c: Json) => c.mentors).filter((m: Json) => m.voice);
  check("…on the board against Asha in both her classes, nobody else", withVoice.length === 2 && withVoice.every((m: Json) => m.name === "Asha" && m.voice.url === url1 && m.voice.seconds === 0.2), show(withVoice));
  const second = wav(6000, 3);
  r = await call("PUT", `/class-tv/voices/mentor:${ASHA}`, root, { audio: second.toString("base64"), seconds: 0.27 });
  const url2: string = r.body?.data?.url ?? "";
  got = await fetch(`${ROOT}${url2}`);
  bytes = Buffer.from(await got.arrayBuffer());
  check("recorded again (bare base64): a new address, the new sound", url2 !== url1 && /\?v=2$/.test(url2) && bytes.equals(second), `${url1} → ${url2}`);

  r = await call("PUT", "/class-tv/voices/common:soon", root, { audio: dataUrl(wav(3000, 5)), seconds: 0.14 });
  const soonUrl: string = r.body?.data?.url ?? "";
  r = await call("GET", "/public/class-tv?academy=dubai");
  check("one common line recorded: it serves both moments", !!soonUrl && r.body?.data?.voices?.soon?.url === soonUrl && r.body.data.voices.now?.url === soonUrl, show(r.body?.data?.voices));
  r = await call("PUT", "/class-tv/voices/common:now", root, { audio: dataUrl(wav(3000, 7)), seconds: 0.14 });
  const nowUrl: string = r.body?.data?.url ?? "";
  r = await call("GET", "/public/class-tv?academy=dubai");
  check("both recorded: each its own", r.body?.data?.voices?.soon?.url === soonUrl && r.body.data.voices.now?.url === nowUrl && nowUrl !== soonUrl, show(r.body?.data?.voices));

  r = await call("GET", "/class-tv/voices", root);
  const v = r.body?.data ?? {};
  // Bangalore's classes couldn't be read a moment ago, so only Dubai's count yet: Ben's workshop (his other is cancelled).
  check("the Mentor voices list: everybody the LMS has, those teaching today first", (v.mentors ?? []).map((m: Json) => `${m.name}:${m.classesToday}`).join() === "Asha:2,Ben:1,Ravi:0,Zed:0", show((v.mentors ?? []).map((m: Json) => `${m.name}:${m.classesToday}`)));
  check("…and it says the LMS couldn't be read for part of it", /LMS would not list today's classes/.test(v.error ?? ""), show(v.error));
  check("…Ben's cancelled class not counted, each with their academy and email", (v.mentors ?? []).find((m: Json) => m.name === "Ravi")?.academy === "bangalore" && (v.mentors ?? []).find((m: Json) => m.name === "Asha")?.email === "asha@lms-e2e.test", show(v.mentors?.[2]));
  check("…Asha's recording, the others none; the two common lines", (v.mentors ?? []).filter((m: Json) => m.voice).map((m: Json) => m.name).join() === "Asha" && v.mentors[0].voice.url === url2 && v.common?.soon?.url === soonUrl && v.common?.now?.url === nowUrl, show(v.common));

  step("Case 4 — recordings that can't be kept");
  r = await call("PUT", `/class-tv/voices/mentor:${BEN}`, root, { audio: `data:audio/webm;base64,${Buffer.from("not a wav at all, just some words in a row").toString("base64")}` });
  check("not a WAV: 400", r.status === 400 && /WAV/.test(r.body?.message ?? ""), show(r.body));
  r = await call("PUT", `/class-tv/voices/mentor:${BEN}`, root, { audio: dataUrl(wav(330_000)) });
  check("longer than fits: 400, with how much fits", r.status === 400 && /KB/.test(r.body?.message ?? ""), show(r.body));
  r = await call("PUT", "/class-tv/voices/common:later", root, { audio: dataUrl(first) });
  check("a line that isn't one: 404", r.status === 404 && (await call("PUT", "/class-tv/voices/mentor:nobody", root, { audio: dataUrl(first) })).status === 404, show(r.body));
  check("a recording that isn't there: 404", (await fetch(`${ROOT}/public/class-tv/voice/64a0000000000000000000ff`)).status === 404 && (await fetch(`${ROOT}/public/class-tv/voice/nonsense`)).status === 404);
  r = await call("GET", "/class-tv/voices", root);
  check("…and Ben still has none", (r.body?.data?.mentors ?? []).find((m: Json) => m.name === "Ben")?.voice === null);

  step("Case 2 — removing one");
  r = await call("DELETE", "/class-tv/voices/common:now", root);
  check("the starting line removed", r.status === 200 && r.body?.data?.removed === true, show(r.body));
  r = await call("GET", "/public/class-tv?academy=dubai");
  check("…the other serves both moments again", r.body?.data?.voices?.now?.url === soonUrl, show(r.body?.data?.voices));
  check("…its sound is gone, and removing it again says so", (await fetch(`${ROOT}${nowUrl}`)).status === 404 && (await call("DELETE", "/class-tv/voices/common:now", root)).status === 404);

  step("Case 3 — the LMS asked once a minute, however many screens");
  for (let i = 0; i < 5; i++) await call("GET", "/public/class-tv?academy=dubai");
  await call("GET", "/class-tv?academy=dubai", root);
  check("Dubai's classes asked for once through all of that — recordings showed without asking again", dayHits(240).length === 1, show(dayHits(240).length));
  check("…and the HRMS still asked only that once: the faces are kept ten minutes", hrmsHits.length === 1, show(hrmsHits.length));

  step("Case 3 — the pure parts");
  const { classesOf, dayOf } = await import("../services/classTvService.js");
  same("Dubai's day at 00:30 its time", (({ day, from, to }) => [day, from.toISOString(), to.toISOString()])(dayOf("dubai", Date.parse("2026-11-13T20:30:00Z"))), ["2026-11-14", "2026-11-13T20:00:00.000Z", "2026-11-14T19:59:59.999Z"]);
  same("Bangalore's day at that same moment — its own, an hour and a half ahead", (({ day, from }) => [day, from.toISOString()])(dayOf("bangalore", Date.parse("2026-11-13T20:30:00Z"))), ["2026-11-14", "2026-11-13T18:30:00.000Z"]);
  same("…and at 23:00 Dubai time Bangalore is already in tomorrow", [dayOf("dubai", Date.parse("2026-11-14T19:00:00Z")).day, dayOf("bangalore", Date.parse("2026-11-14T19:00:00Z")).day], ["2026-11-14", "2026-11-15"]);
  oldLms = true;
  const old = classesOf("dubai", mentors() as never, dayOf("dubai"));
  // Only the newer LMS can tell a class lent to the other academy: before it, a class goes by its first mentor's.
  check("an LMS from before it said where: classes by their mentor's academy (the one lent to Bangalore with its Dubai mentor), no place, taken as online", old.classes.map((c) => c.id).join() === "c2,c5,c1,c3" && old.classes.every((c) => c.place === "" && c.online === true), show(old.classes.map((c) => [c.id, c.place, c.online])));
  const oldBlr = classesOf("bangalore", mentors() as never, dayOf("bangalore"));
  check("…and Bangalore's board then has only its own mentors' classes", oldBlr.classes.map((c) => c.id).join() === "c4", show(oldBlr.classes.map((c) => c.id)));
  oldLms = false;

  step("Case 4 — the LMS goes down during the day (after its minute)");
  down = true;
  await sleep(Math.max(0, dxbAskedAt + 61_000 - Date.now()));
  await call("GET", "/public/class-tv?academy=dubai");   // this one sets the asking off, and is answered from what is kept
  await sleep(1_500);
  r = await call("GET", "/public/class-tv?academy=dubai");
  check("today's board kept through the failure, and the answer says so", r.body?.data?.status === "error" && r.body.data.classes.length === 3 && r.body.data.error === "Today's classes can't be reached right now.", show({ status: r.body?.data?.status, n: r.body?.data?.classes?.length }));
  check("…asked again only after its minute", dayHits(240).length === 2, show(dayHits(240).length));
  down = false;

  step("Case 1 — Bangalore's board, once its minute is over");
  await sleep(Math.max(0, blrAskedAt + 61_000 - Date.now()));
  hrmsDown = true;   // Ravi's face is first wanted now, and the HRMS can't be asked
  r = await call("GET", "/public/class-tv?academy=bangalore");
  const b = r.body?.data ?? {};
  check("Bangalore's own classes and the one lent to it, in India's day", b.status === "ok" && b.academyName === "Bangalore" && b.timezone === "Asia/Kolkata" && (b.classes ?? []).map((c: Json) => c.id).join() === "c4,c5", show((b.classes ?? []).map((c: Json) => c.id)));
  check("…the lent class under its Dubai mentor, the common line there too", (b.classes ?? []).find((c: Json) => c.id === "c5")?.mentors?.[0]?.name === "Ben" && b.voices?.soon?.url === soonUrl, show(b.voices));
  check("…asked of the LMS for India's day", dayHits(330).length === 2 && dayHits(330).every((h) => h.secret), show(dayHits(330).length));
  check("Case 6 — the HRMS down: the board carries on, Ravi without a face", b.status === "ok" && (b.classes ?? []).find((c: Json) => c.id === "c4")?.mentors?.[0]?.photoUrl === null && hrmsHits.length === 2, show({ hrms: hrmsHits.length, c4: (b.classes ?? []).find((c: Json) => c.id === "c4")?.mentors }));
  check("…Ben with the face it already had, and only Ravi was asked about", (b.classes ?? []).find((c: Json) => c.id === "c5")?.mentors?.[0]?.photoUrl === PHOTO("ben") && hrmsHits[1]!.people.map((p) => p.email).join() === "ravi@lms-e2e.test", show(hrmsHits[1]));
  hrmsDown = false;
  r = await call("GET", "/class-tv/voices", root);
  // Dubai's board is still the one kept through the failure above, so the list goes on saying the LMS couldn't be read.
  check("the Mentor voices list now counts both academies' classes", (r.body?.data?.mentors ?? []).map((m: Json) => `${m.name}:${m.classesToday}`).join() === "Asha:2,Ben:2,Ravi:1,Zed:0", show((r.body?.data?.mentors ?? []).map((m: Json) => `${m.name}:${m.classesToday}`)));
  r = await call("GET", "/public/class-tv?academy=mars");
  check("an academy that isn't one: Dubai's", r.body?.data?.academy === "dubai");

  console.log(`\n${checks - failures}/${checks} checks passed`);
}

main()
  .catch((err) => { console.error(err); failures++; })
  .finally(async () => {
    stand.close();
    await mongoose.disconnect().catch(() => {});
    process.exit(failures ? 1 : 0);
  });
