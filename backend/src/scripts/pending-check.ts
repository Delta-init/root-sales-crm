/**
 * Drives the Pending page's API end to end: GET /api/v1/pending against the
 * real portal backend, with scratch databases standing in for the CRMs.
 *
 * What it proves:
 *   - each CRM's counts are its sidebar's badges, per salesperson: New leads
 *     (assigned to them, status "assigned") and Reminders (theirs, not done —
 *     overdue ones counted apart), the same numbers the CRM's own badge
 *     queries give;
 *   - somebody who has left keeps the work sitting with them, marked; a lead
 *     assigned to an account that no longer exists still counts;
 *   - one person in two CRMs, by email, is one row across portals;
 *   - a CRM with nothing pending shows nothing, and a CRM that cannot be read
 *     — no database set, or not answering — says why, the rest standing;
 *   - the portals not on the page yet are listed as coming;
 *   - root admins only.
 *
 * Run through scripts/pending-check.sh (throwaway mongod, the real backend).
 */
import mongoose, { Types } from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
for (const [name, value] of [
  ["MONGODB_URI", uri],
  ["DELTA_MONGODB_URI", process.env.DELTA_MONGODB_URI ?? ""],
  ["DRAW_MONGODB_URI", process.env.DRAW_MONGODB_URI ?? ""],
] as const) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "PendingE2e!pass1";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 400);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}${path}`, { method, headers: { "content-type": "application/json", ...headers } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const deltaDb = (await mongoose.createConnection(process.env.DELTA_MONGODB_URI!).asPromise()).db!;
  const drawDb = (await mongoose.createConnection(process.env.DRAW_MONGODB_URI!).asPromise()).db!;

  step("Setting up: the registry, two admins, and two CRMs with people, leads and reminders");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  const orgs: [string, string, string, number][] = [
    ["delta", "crm", "Delta CRM", 1],
    ["banglore", "crm", "Banglore CRM", 2],
    ["draw", "crm", "Draw CRM", 3],
    ["remote", "crm", "Remote CRM", 3.5],
    ["finance-hq", "finance", "Finance HQ", 4],
  ];
  for (const [code, kind, name, sortOrder] of orgs) {
    await Organization.create({ code, kind, name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@pending-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@pending-e2e.test", password: PASSWORD, role: "member", status: "active" });

  const asha = new Types.ObjectId(), bina = new Types.ObjectId(), old = new Types.ObjectId(), nusraD = new Types.ObjectId(), gone = new Types.ObjectId();
  await deltaDb.collection("users").insertMany([
    { _id: asha, name: "Asha", email: "asha@delta-e2e.test", status: "active" },
    { _id: bina, name: "Bina", email: "bina@delta-e2e.test", status: "active" },
    { _id: old, name: "Old Hand", email: "old@delta-e2e.test", status: "inactive" },
    // Nusra works in both CRMs, under the same email.
    { _id: nusraD, name: "Nusra", email: "Nusra@Shared-e2e.test", status: "active" },
  ]);
  const past = new Date(Date.now() - 2 * 60 * 60_000);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60_000);
  let n = 0;
  const lead = (assignedTo: Types.ObjectId | null, status: string, reminders: Record<string, unknown>[] = []) => ({
    name: `Lead ${++n}`, phone: `+97150000${String(n).padStart(4, "0")}`, assignedTo, status, reminders, createdAt: new Date(),
  });
  await deltaDb.collection("leads").insertMany([
    lead(asha, "assigned"), lead(asha, "assigned"), lead(asha, "assigned"),
    lead(asha, "followup"),                                   // worked already: not new
    lead(null, "assigned"),                                   // nobody's: no badge shows it
    lead(old, "assigned"), lead(old, "assigned"),             // left, the leads still with them
    lead(gone, "assigned"),                                   // an account that no longer exists
    lead(nusraD, "assigned"),
    lead(bina, "followup", [
      { _id: new Types.ObjectId(), createdBy: asha, remindAt: past, isDone: false },     // Asha's, overdue
      { _id: new Types.ObjectId(), createdBy: asha, remindAt: future, isDone: false },   // Asha's, to come
      { _id: new Types.ObjectId(), createdBy: asha, remindAt: past, isDone: true },      // done: not pending
      { _id: new Types.ObjectId(), createdBy: bina, remindAt: future },                  // no isDone written: not done
    ]),
  ]);
  const nusraW = new Types.ObjectId();
  await drawDb.collection("users").insertMany([{ _id: nusraW, name: "Nusra", email: "nusra@shared-e2e.test", status: "active" }]);
  await drawDb.collection("leads").insertMany([
    lead(nusraW, "assigned"), lead(nusraW, "assigned"),
    lead(nusraW, "followup", [{ _id: new Types.ObjectId(), createdBy: nusraW, remindAt: future, isDone: false }]),
  ]);

  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@pending-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@pending-e2e.test")}` };

  // The CRMs' own badge queries, run here on the same data: what each sidebar would say.
  const badgeNew = async (db: typeof deltaDb, user: Types.ObjectId) => db.collection("leads").countDocuments({ assignedTo: user, status: "assigned" });
  const badgeReminders = async (db: typeof deltaDb, user: Types.ObjectId) => {
    const docs = await db.collection("leads").find({ "reminders.createdBy": user }, { projection: { reminders: 1 } }).toArray();
    return docs.reduce((c, d) => c + ((d.reminders ?? []) as Json[]).filter((r) => String(r.createdBy) === String(user) && !r.isDone).length, 0);
  };

  step("Case 1 — happy path: each CRM's badges, per salesperson");
  let r = await call("GET", "/pending", root);
  check("a root admin reads it", r.status === 200 && Array.isArray(r.body?.data?.portals), `${r.status} ${show(r.body)}`);
  let data = r.body?.data;
  const portal = (code: string) => (data?.portals ?? []).find((p: Json) => p.code === code);
  const person = (code: string, name: string) => portal(code)?.people?.find((p: Json) => p.name === name);
  const kind = (code: string, key: string) => portal(code)?.kinds?.find((k: Json) => k.key === key);
  const a = person("delta", "Asha");
  check("Asha: 3 new leads and 2 reminders, 1 of them overdue — 5", a?.counts?.new_leads === 3 && a?.counts?.reminders === 2 && a?.counts?.reminders_overdue === 1 && a?.total === 5, show(a));
  check("…the same as her own sidebar's two badges", a?.counts?.new_leads === await badgeNew(deltaDb, asha) && a?.counts?.reminders === await badgeReminders(deltaDb, asha));
  const b = person("delta", "Bina");
  check("Bina: a reminder with no done flag written is still open", b?.counts?.reminders === 1 && b?.counts?.new_leads === 0 && b?.counts?.reminders === await badgeReminders(deltaDb, bina), show(b));
  check("Delta's totals: 7 new leads, 3 reminders, 1 overdue — 10",
    kind("delta", "new_leads")?.total === 7 && kind("delta", "reminders")?.total === 3 && kind("delta", "reminders")?.overdue === 1 && portal("delta")?.total === 10,
    show(portal("delta")?.kinds));
  check("the most waiting first", portal("delta")?.people?.[0]?.name === "Asha", show(portal("delta")?.people?.map((p: Json) => p.name)));
  check("Draw: Nusra's 2 new leads and 1 reminder", person("draw", "Nusra")?.counts?.new_leads === 2 && person("draw", "Nusra")?.counts?.reminders === 1);
  const nusra = (data?.people ?? []).find((p: Json) => p.email === "nusra@shared-e2e.test");
  check("one person across CRMs, by email whatever its case: Nusra 4, from Delta and Draw",
    nusra?.total === 4 && new Set(nusra.items.map((i: Json) => i.portal)).size === 2
    && (data?.people ?? []).filter((p: Json) => p.name === "Nusra").length === 1, show(nusra));
  check("across portals, the most waiting first", data?.people?.[0]?.name === "Asha" || data?.people?.[0]?.total >= data?.people?.[1]?.total);

  step("Case 2 — edges: people who left, accounts gone, nothing pending");
  const o = person("delta", "Old Hand");
  check("somebody who left still shows the 2 leads sitting with them, marked as gone", o?.counts?.new_leads === 2 && o?.active === false, show(o));
  const u = person("delta", "Unknown user");
  check("a lead assigned to an account that no longer exists still counts", u?.counts?.new_leads === 1 && u?.active === false, show(u));
  check("a lead nobody is assigned to, and one already worked, count for nobody",
    !(portal("delta")?.people ?? []).some((p: Json) => p.id === "null") && kind("delta", "new_leads")?.total === 7);
  await drawDb.collection("leads").updateMany({}, { $set: { status: "followup", "reminders.$[].isDone": true } });
  r = await call("GET", "/pending", root);
  data = r.body?.data;
  check("Draw with nothing pending: 0, and nobody listed", portal("draw")?.available === true && portal("draw")?.total === 0 && portal("draw")?.people?.length === 0, show(portal("draw")));
  check("…and Nusra is down to her one Delta lead", (data?.people ?? []).find((p: Json) => p.email === "nusra@shared-e2e.test")?.total === 1);

  step("Case 3 — a portal that cannot be read says so; the rest stand");
  check("Remote, with no database set: says which setting is missing", portal("remote")?.available === false && /REMOTE_MONGODB_URI/.test(portal("remote")?.error ?? ""), show(portal("remote")));
  check("Banglore, not answering: says it could not be reached", portal("banglore")?.available === false && !!portal("banglore")?.error, show(portal("banglore")));
  check("…and Delta and Draw are there all the same", portal("delta")?.available === true && portal("draw")?.available === true);
  check("in the registry's order", show((data?.portals ?? []).map((p: Json) => p.code)) === show(["delta", "banglore", "draw", "remote"]), show((data?.portals ?? []).map((p: Json) => p.code)));
  check("the portals not on the page yet are listed as coming", (data?.comingNext ?? []).some((c: Json) => c.code === "finance-hq") && !(data?.portals ?? []).some((p: Json) => p.code === "finance-hq"), show(data?.comingNext));

  step("Case 4 — root admins only");
  check("no session: 401", (await call("GET", "/pending")).status === 401);
  check("an admin who is not a root admin: 403", (await call("GET", "/pending", member)).status === 403);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
