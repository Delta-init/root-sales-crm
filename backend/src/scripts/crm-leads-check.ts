/**
 * POST /api/v1/service/crm-leads (services/crmLeadMatchService.ts), end to end —
 * the LMS asking which sales CRMs its students are leads in:
 *
 *   Case 1  happy path   by email (any case), by phone in several formats
 *                        (+971 50 …, 0050…, "050… / 055…"), across three CRMs,
 *                        newest first, the holder's name and the status label
 *   Case 2  edge         a lead found by email and phone counted once (email);
 *                        at most 5; a short phone matches nothing; a longer
 *                        number ending differently is not a match; unknown
 *                        person → []; a CRM that cannot be read → failures
 *   Case 3  errors       none, more than 100, no id → 400
 *   Case 4  permission   no secret, a wrong one, a CRM's secret → 401; the LMS
 *                        switched off in the registry → 503
 *
 * Run through scripts/crm-leads-check.sh. Scratch databases on 127.0.0.1 only.
 */
import mongoose, { Types } from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
for (const [name, value] of [
  ["MONGODB_URI", uri],
  ["DELTA_MONGODB_URI", process.env.DELTA_MONGODB_URI ?? ""],
  ["DRAW_MONGODB_URI", process.env.DRAW_MONGODB_URI ?? ""],
  ["REMOTE_MONGODB_URI", process.env.REMOTE_MONGODB_URI ?? ""],
] as const) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}
const LMS_SECRET = process.env.LMS_SSO_SECRET ?? "";
if (!LMS_SECRET.includes("e2e")) {
  console.error("Refusing to run: LMS_SSO_SECRET must be the check's own e2e value");
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 600);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function ask(body: unknown, secret: string | null = LMS_SECRET): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-portal-secret"] = secret;
  const r = await fetch(`${ROOT}/service/crm-leads`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const z = (iso: string) => new Date(iso);

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const open = async (u: string) => (await mongoose.createConnection(u).asPromise()).db!;
  const deltaDb = await open(process.env.DELTA_MONGODB_URI!);
  const drawDb = await open(process.env.DRAW_MONGODB_URI!);
  const remoteDb = await open(process.env.REMOTE_MONGODB_URI!);
  for (const db of [mongoose.connection.db!, deltaDb, drawDb, remoteDb]) await db.dropDatabase();

  step("Setting up: the registry (four CRMs and the LMS), people and leads in three CRM databases");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, name, sortOrder] of [["delta", "Delta CRM", 1], ["banglore", "Banglore CRM", 2], ["draw", "Draw CRM", 3], ["remote", "Remote CRM", 4]] as const) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await Organization.create({ code: "lms", kind: "lms", name: "LMS", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 9, accent: "#2563eb" });
  // A CRM's index on email, as the CRMs build it — the email side should use it.
  for (const db of [deltaDb, drawDb, remoteDb]) await db.collection("leads").createIndex({ email: 1 });

  const ria = new Types.ObjectId(), irfana = new Types.ObjectId(), nusra = new Types.ObjectId();
  await deltaDb.collection("users").insertOne({ _id: ria, name: "Ria", email: "ria@delta-e2e.test", status: "active" });
  await drawDb.collection("users").insertOne({ _id: irfana, name: "Irfana", email: "irfana@draw-e2e.test", status: "active" });
  await remoteDb.collection("users").insertOne({ _id: nusra, name: "Nusra", email: "nusra@remote-e2e.test", status: "active" });

  const ids = {
    ashaDelta: new Types.ObjectId(),
    bilalDelta: new Types.ObjectId(), bilalDraw: new Types.ObjectId(), bilalRemote: new Types.ObjectId(),
    both: new Types.ObjectId(),
  };
  await deltaDb.collection("leads").insertMany([
    // Email: stored lower-cased, as the CRMs' schema stores it.
    { _id: ids.ashaDelta, name: "Asha", email: "asha@lms-e2e.test", phone: "+971500000001", status: "followup", assignedTo: ria, createdAt: z("2026-10-02T08:00:00Z") },
    // Two numbers in one field; Bilal is the first, Chen the second.
    { _id: ids.bilalDelta, name: "Bilal", phone: "050 123 4567 / 055 765 4321", status: "assigned", assignedTo: ria, createdAt: z("2026-10-01T08:00:00Z") },
    // Found by both email and phone: one lead.
    { _id: ids.both, name: "Dana", email: "dana@lms-e2e.test", phone: "+971 52 222 3333", status: "closed", assignedTo: null, createdAt: z("2026-10-05T08:00:00Z") },
    // A longer number whose tail differs: not Bilal's.
    { name: "Decoy", phone: "+971 50 123 45678", status: "new", createdAt: z("2026-10-09T08:00:00Z") },
    // A number ending in the short phone's digits: the short phone must not reach it.
    { name: "Shorty", phone: "+971 4 1234567", status: "new", createdAt: z("2026-10-09T08:00:00Z") },
    // Seven leads for one email, spread over the CRMs below too: only the 5 newest come back.
    ...[1, 2, 3, 4].map((d) => ({ name: `Many ${d}`, email: "many@lms-e2e.test", phone: `+97156000000${d}`, status: "new", createdAt: z(`2026-09-0${d}T08:00:00Z`) })),
  ]);
  await drawDb.collection("leads").insertMany([
    { _id: ids.bilalDraw, name: "Bilal D", phone: "00971501234567", status: "callback", assignedTo: irfana, createdAt: z("2026-10-03T08:00:00Z") },
    ...[5, 6].map((d) => ({ name: `Many ${d}`, email: "MANY@lms-e2e.test".toLowerCase(), phone: `+97156000000${d}`, status: "new", createdAt: z(`2026-09-0${d}T08:00:00Z`) })),
  ]);
  await remoteDb.collection("leads").insertMany([
    { _id: ids.bilalRemote, name: "Bilal R", phone: "+971-50-123-4567, 04 999 8888", status: "pending_response", assignedTo: nusra, createdAt: z("2026-10-04T08:00:00Z") },
    { name: "Many 7", email: "many@lms-e2e.test", phone: "+971560000007", status: "new", createdAt: z("2026-09-07T08:00:00Z") },
  ]);

  step("Case 1 — happy path");
  let r = await ask({ people: [
    { id: "u-asha", email: "  Asha@LMS-e2e.TEST " },
    { id: "u-bilal", phone: "+971 50 123 4567" },
    { id: "u-chen", phone: "0557654321" },
  ] });
  const res = r.body?.data?.results ?? {};
  check("200, the usual envelope, a key for every id", r.status === 200 && r.body?.success === true && ["u-asha", "u-bilal", "u-chen"].every((k) => Array.isArray(res[k])), show(r.body));
  const asha = res["u-asha"]?.[0];
  check("email, any case and spaces: Asha's Delta lead, by email", res["u-asha"]?.length === 1 && asha?.crm === "delta" && asha.crmName === "Delta CRM"
    && asha.leadId === String(ids.ashaDelta) && asha.leadName === "Asha" && asha.matchedBy === "email", show(res["u-asha"]));
  check("…with its status, its label, the holder's name and the ISO date", asha?.status === "followup" && asha.statusLabel === "Follow-up" && asha.assignedTo === "Ria"
    && asha.createdAt === "2026-10-02T08:00:00.000Z", show(asha));
  const bilal = res["u-bilal"] ?? [];
  check("phone +971 50 123 4567: found in Delta (\"050 123 4567 / 055…\"), Draw (00971…) and Remote (+971-50-…, 04…)",
    bilal.length === 3 && bilal.every((m: Json) => m.matchedBy === "phone"), show(bilal));
  check("…newest first across the CRMs: Remote 4 Oct, Draw 3 Oct, Delta 1 Oct",
    show(bilal.map((m: Json) => [m.crm, m.leadId])) === show([["remote", String(ids.bilalRemote)], ["draw", String(ids.bilalDraw)], ["delta", String(ids.bilalDelta)]]), show(bilal));
  check("…each holder from its own CRM, each status labelled", show(bilal.map((m: Json) => m.assignedTo)) === show(["Nusra", "Irfana", "Ria"])
    && bilal[0]?.statusLabel === "Pending response" && bilal[1]?.statusLabel === "Callback", show(bilal));
  check("the second number in a field matches too: Chen → Bilal's Delta lead", res["u-chen"]?.length === 1 && res["u-chen"][0].leadId === String(ids.bilalDelta), show(res["u-chen"]));
  check("Banglore cannot be read: in failures, the others still answered", (r.body?.data?.failures ?? []).some((f: Json) => f.code === "banglore" && f.name === "Banglore CRM" && f.error)
    && (r.body?.data?.failures ?? []).length === 1, show(r.body?.data?.failures));

  step("Case 2 — edges");
  r = await ask({ people: [
    { id: "u-dana", email: "dana@lms-e2e.test", phone: "0522223333" },
    { id: "u-many", email: "many@lms-e2e.test" },
    { id: "u-short", phone: "1234567" },
    { id: "u-nobody", email: "nobody@lms-e2e.test", phone: "+971 59 999 0000" },
    { id: "u-blank", email: "", phone: "" },
    { id: "u-noemail", email: "not-an-email" },
  ] });
  const e = r.body?.data?.results ?? {};
  check("email and phone on one lead: once, matched by email", e["u-dana"]?.length === 1 && e["u-dana"][0].matchedBy === "email" && e["u-dana"][0].leadId === String(ids.both)
    && e["u-dana"][0].assignedTo === "", show(e["u-dana"]));
  check("seven leads across three CRMs: the 5 newest, newest first", show((e["u-many"] ?? []).map((m: Json) => m.leadName)) === show(["Many 7", "Many 6", "Many 5", "Many 4", "Many 3"])
    && new Set((e["u-many"] ?? []).map((m: Json) => m.crm)).size === 3, show(e["u-many"]));
  check("a phone under 9 digits matches nothing", Array.isArray(e["u-short"]) && e["u-short"].length === 0, show(e["u-short"]));
  check("someone unknown: an empty list, not a missing key", Array.isArray(e["u-nobody"]) && e["u-nobody"].length === 0, show(e["u-nobody"]));
  check("blank email and phone, or not an email: empty lists", e["u-blank"]?.length === 0 && e["u-noemail"]?.length === 0, show([e["u-blank"], e["u-noemail"]]));
  r = await ask({ people: [{ id: "u-bilal", phone: "0501234567" }] });
  check("a longer number ending differently is not a match (Decoy)", (r.body?.data?.results?.["u-bilal"] ?? []).every((m: Json) => m.leadName !== "Decoy")
    && r.body?.data?.results?.["u-bilal"]?.length === 3, show(r.body?.data?.results));
  r = await ask({ people: Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, email: `p${i}@lms-e2e.test`, phone: `+97150${String(i).padStart(7, "0")}` })) });
  check("100 people at once: 200, 100 keys", r.status === 200 && Object.keys(r.body?.data?.results ?? {}).length === 100, show(r.body).slice(0, 200));

  step("Case 3 — errors");
  check("more than 100 people: 400", (await ask({ people: Array.from({ length: 101 }, (_, i) => ({ id: `p${i}` })) })).status === 400);
  check("no people: 400", (await ask({ people: [] })).status === 400 && (await ask({})).status === 400);
  check("a person with no id: 400", (await ask({ people: [{ email: "a@b.c" }] })).status === 400 && (await ask({ people: [{ id: "  " }] })).status === 400);

  step("Case 4 — the LMS's secret, and nothing else");
  const ok = { people: [{ id: "x", email: "asha@lms-e2e.test" }] };
  check("no secret: 401", (await ask(ok, null)).status === 401);
  check("a wrong one: 401", (await ask(ok, "nope")).status === 401);
  check("a wrong one of the same length: 401", (await ask(ok, "x".repeat(LMS_SECRET.length))).status === 401);
  check("a CRM's secret (Delta's): 401", (await ask(ok, process.env.DELTA_SSO_SECRET ?? "")).status === 401);
  const crmDoor = await fetch(`${ROOT}/service/crm-leads`, { method: "POST", headers: { "content-type": "application/json", "x-org-secret": process.env.DELTA_SSO_SECRET ?? "" }, body: JSON.stringify(ok) });
  check("…nor Delta's on the CRMs' header: 401", crmDoor.status === 401);
  const tracker = await fetch(`${ROOT}/service/tracker/me?userId=x`, { headers: { "x-portal-secret": LMS_SECRET } });
  check("the CRMs' own service routes still want a CRM's secret", tracker.status === 401);
  await Organization.updateOne({ code: "lms" }, { $set: { isActive: false } });
  r = await ask(ok);
  check("the LMS switched off in the registry: 503", r.status === 503, show(r.body));
  await Organization.updateOne({ code: "lms" }, { $set: { isActive: true } });
  check("…and back on: 200", (await ask(ok)).status === 200);
  // The running server has the secret; the door itself is asked, here, without one.
  const { authenticatePortalService } = await import("../middleware/orgServiceAuth.js");
  const saved = process.env.LMS_SSO_SECRET;
  process.env.LMS_SSO_SECRET = "";
  let got: { status?: number; body?: Json; next?: boolean } = {};
  const fakeRes = { status(s: number) { got.status = s; return this; }, json(b: Json) { got.body = b; return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await authenticatePortalService("lms")({ headers: { "x-portal-secret": "" } } as any, fakeRes as any, () => { got.next = true; });
  process.env.LMS_SSO_SECRET = saved;
  check("no LMS_SSO_SECRET set on Root: 503 naming it, an empty header does not get through", got.status === 503 && !got.next && /LMS_SSO_SECRET/.test(got.body?.message ?? ""), show(got));

  console.log(`\n${checks - failures}/${checks} checks passed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
