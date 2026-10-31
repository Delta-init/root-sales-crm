/**
 * Commission plans kept in Root (2026-11-01), end to end — services/commissionPlanService.ts, the copy script and
 * /api/v1/commission-plans:
 *
 *   Case 1  copy         a dry run writes nothing; --write copies each reachable CRM's plan: every course's row, the
 *                        Sales Manager and who earns nothing, the slabs as versions (built-in first, a saved version's
 *                        empty position taking the built-in rows); the page shows it beside the CRM's own
 *   Case 2  edit         a course's row, a position's slabs (from this month, the others carried), the Sales Manager
 *                        and who earns nothing; each recorded against the root admin; the CRM's database untouched
 *   Case 3  edge         a course added to the CRM after the copy shows "not set"; copying again leaves Root's edits;
 *                        --replace copies again and keeps Root's previous plan in an undo file
 *   Case 4  errors       Draw's team leaders paid on a sale, a slab not starting at 0 or not rising, Draw's TL slab,
 *                        an unknown course or person, a portal never copied (409) or with no plan (404)
 *   Case 5  permission   no session → 401, an admin who is not a root admin → 403
 *
 * Run through scripts/commission-plan-check.sh. Scratch databases on 127.0.0.1 only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
const PASSWORD = "PlanE2e!pass1";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 500);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(method: string, p: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}${p}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
/** The copy script, as somebody runs it — against the scratch databases this check's runner set. */
function copy(...args: string[]) {
  const r = spawnSync("bun", ["--no-env-file", path.join(process.env.E2E_REPO!, "src/scripts/commission-plan-copy.ts"), ...args], { cwd: process.env.E2E_WORK, env: process.env, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const uaeMonth = () => new Date(Date.now() + 4 * 60 * 60_000).toISOString().slice(0, 7);

async function main() {
  mongoose.set("autoIndex", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const deltaDb = (await mongoose.createConnection(process.env.DELTA_MONGODB_URI!).asPromise()).db!;
  const drawDb = (await mongoose.createConnection(process.env.DRAW_MONGODB_URI!).asPromise()).db!;
  for (const db of [mongoose.connection.db!, deltaDb, drawDb]) await db.dropDatabase();

  step("Setting up: the registry, two admins, the Sales CRM and Draw with courses, people and commission settings");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, name, sortOrder] of [["delta", "Delta CRM", 1], ["banglore", "Banglore CRM", 2], ["draw", "Draw CRM", 3], ["remote", "Remote CRM", 4]] as const) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency: code === "banglore" ? "INR" : "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@plan-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@plan-e2e.test", password: PASSWORD, role: "member", status: "active" });

  const abrar = new Types.ObjectId(), shared = new Types.ObjectId(), ria = new Types.ObjectId(), lena = new Types.ObjectId();
  await deltaDb.collection("users").insertMany([
    { _id: abrar, name: "Abrar", status: "active" }, { _id: shared, name: "Shared login", status: "active" },
    { _id: ria, name: "Ria", status: "active" }, { _id: lena, name: "Lena", status: "active" },
  ]);
  const mbt = new Types.ObjectId(), dwt = new Types.ObjectId(), free = new Types.ObjectId();
  await deltaDb.collection("courses").insertMany([
    { _id: mbt, name: "MBT", amount: 2250, status: "active", commission: { sales: 230, tl: 85, sm: 85, creditUsd: 0 } },
    { _id: dwt, name: "DWT", amount: 5500, status: "active", commission: { sales: 500, tl: 200, sm: 150, creditUsd: 100 } },
    { _id: free, name: "Free webinar", amount: 0, status: "active" },
  ]);
  // A saved version from September with only Sales Staff rows: its TL and SM take the built-in rows, as the CRM does.
  await deltaDb.collection("commissionsettings").insertOne({
    key: "default", salesManager: abrar, excludedUsers: [shared],
    salarySlabs: [{ from: "2026-09", sales: [{ name: "Base", target: 0, salary: 2100, percent: 0 }, { name: "A", target: 30000, salary: 4000, percent: 100 }], tl: [], sm: [] }],
  });
  const maneesh = new Types.ObjectId(), irfana = new Types.ObjectId();
  await drawDb.collection("users").insertMany([{ _id: maneesh, name: "Maneesh", status: "active" }, { _id: irfana, name: "Irfana", status: "active" }]);
  const drawMbt = new Types.ObjectId();
  await drawDb.collection("courses").insertOne({ _id: drawMbt, name: "MBT", amount: 2250, status: "active", commission: { sales: 230, tl: 0, sm: 85 } });
  await drawDb.collection("commissionsettings").insertOne({ key: "default", salesManager: maneesh, excludedUsers: [] });
  const deltaBefore = JSON.stringify(await deltaDb.collection("courses").find().sort({ name: 1 }).toArray()) + JSON.stringify(await deltaDb.collection("commissionsettings").find().toArray());

  const login = async (email: string) => {
    const r = await fetch(`${ROOT}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
    const b: Json = await r.json().catch(() => ({}));
    return b?.data?.accessToken ?? b?.data?.token ?? b?.accessToken;
  };
  const root = { authorization: `Bearer ${await login("root@plan-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@plan-e2e.test")}` };
  const plansNow = async () => (await call("GET", "/commission-plans", root)).body?.data ?? [];
  const planOf = async (code: string) => (await plansNow()).find((p: Json) => p.code === code);
  const month = uaeMonth();

  step("Case 1 — the copy");
  let delta = await planOf("delta");
  check("before the copy: the CRM's plan shown, nothing kept in Root", delta?.available && delta.root === null && delta.courses.length === 3, show(delta));
  let out = copy();
  check("a dry run writes nothing, and says what it would copy", out.code === 0 && /Dry run/.test(out.out) && /would be copied/.test(out.out)
    && (await mongoose.connection.db!.collection("commissionplans").countDocuments()) === 0, out.out.slice(-400));
  out = copy("--write");
  check("--write copies the Sales CRM and Draw; Remote and Banglore can't be read", out.code === 0 && (out.out.match(/copied to Root/g) ?? []).length === 2, out.out.slice(-500));
  const kept = await mongoose.connection.db!.collection("commissionplans").findOne({ portal: "delta" });
  check("the Sales CRM's plan in Root: its rule, TL slab, every course's row", kept?.tlRule === "zero_if_sm" && kept.tlSlab === true && kept.courses.length === 3
    && JSON.stringify(kept.courses.find((c: Json) => c.name === "DWT")) .includes('"sales":500') && kept.courses.find((c: Json) => c.name === "Free webinar")?.sales === 0, show(kept?.courses));
  check("…the Sales Manager and who earns nothing, by id and name", kept?.salesManager?.id === String(abrar) && kept.salesManager.name === "Abrar"
    && kept.excluded.length === 1 && kept.excluded[0].name === "Shared login", show({ sm: kept?.salesManager, ex: kept?.excluded }));
  check("…the slabs: the built-in first, then September's — its empty TL and SM taking the built-in rows",
    kept?.slabs?.map((v: Json) => v.from).join() === "2000-01,2026-09" && kept.slabs[1].sales[0].salary === 2100 && kept.slabs[1].tl[1]?.target === 80000 && kept.slabs[1].sm[1]?.target === 200000, show(kept?.slabs));
  const draw0 = await mongoose.connection.db!.collection("commissionplans").findOne({ portal: "draw" });
  check("Draw's: no TL commission rule, no TL slab, its built-in Sales Manager slab", draw0?.tlRule === "never" && draw0.tlSlab === false
    && draw0.slabs.length === 1 && draw0.slabs[0].sm[2]?.target === 154000 && draw0.salesManager?.name === "Maneesh", show(draw0));
  delta = await planOf("delta");
  check("the page: Root's plan beside the CRM's — this month's slabs, the CRM's people to choose from", delta?.root?.slabs?.from === "2026-09" && delta.root.slabs.sales[0].salary === 2100
    && delta.root.people.length === 4 && delta.root.courses.every((c: Json) => c.set && c.inCrm), show(delta?.root?.slabs));

  step("Case 2 — editing");
  let r = await call("PUT", `/commission-plans/delta/courses/${mbt}`, root, { sales: 250, tl: 90, sm: 85, creditUsd: 50 });
  delta = r.body?.data?.find((p: Json) => p.code === "delta");
  const mbtRow = delta?.root?.courses?.find((c: Json) => c.id === String(mbt));
  check("a course's row saved: MBT pays 250 / 90 / 85, $50 credit, by whom", r.status === 200 && mbtRow?.sales === 250 && mbtRow.tl === 90 && mbtRow.creditUsd === 50 && mbtRow.updatedByEmail === "root@plan-e2e.test", show(mbtRow));
  check("…the CRM's own MBT row still 230 (the CRM is untouched)", delta?.courses?.find((c: Json) => c.id === String(mbt))?.sales === 230);
  check("…recorded in the change list, with before and after", /MBT: AED 230 \/ AED 85 \/ AED 85 \/ \$0 → AED 250 \/ AED 90 \/ AED 85 \/ \$50/.test(delta?.root?.changes?.[0]?.detail ?? "") && delta.root.changes[0].by === "root@plan-e2e.test", show(delta?.root?.changes));
  r = await call("PUT", "/commission-plans/delta/slabs/tl", root, { rows: [{ name: "Base", target: 0, salary: 4500, percent: 50 }, { name: "Level 1", target: 90000, salary: 5000, percent: 100 }] });
  const k2 = await mongoose.connection.db!.collection("commissionplans").findOne({ portal: "delta" });
  const v = k2?.slabs?.find((x: Json) => x.from === month);
  check(`the Team Leader slab from ${month}: the new rows; Sales Staff and SM carried from September`, r.status === 200 && v?.tl?.[0]?.salary === 4500 && v.sales[0].salary === 2100 && v.sm[1].target === 200000
    && k2!.slabs.find((x: Json) => x.from === "2026-09").tl[0].salary === 4000, show(v));
  r = await call("PUT", "/commission-plans/delta/slabs/sales", root, { rows: [{ name: "Base", target: 0, salary: 2200, percent: 0 }] });
  const k3 = await mongoose.connection.db!.collection("commissionplans").findOne({ portal: "delta" });
  check("a second change this month replaces this month's version, keeping the TL change", k3?.slabs?.filter((x: Json) => x.from === month).length === 1
    && k3.slabs.find((x: Json) => x.from === month).tl[0].salary === 4500 && k3.slabs.find((x: Json) => x.from === month).sales[0].salary === 2200, show(k3?.slabs));
  r = await call("PUT", "/commission-plans/delta/settings", root, { salesManager: String(lena), excluded: [String(shared), String(ria)] });
  delta = r.body?.data?.find((p: Json) => p.code === "delta");
  check("the Sales Manager and who earns nothing saved, with names", r.status === 200 && delta?.root?.salesManager?.name === "Lena" && delta.root.excluded.map((p: Json) => p.name).join() === "Shared login,Ria", show(delta?.root));
  const deltaAfter = JSON.stringify(await deltaDb.collection("courses").find().sort({ name: 1 }).toArray()) + JSON.stringify(await deltaDb.collection("commissionsettings").find().toArray());
  check("the Sales CRM's database is exactly as it was", deltaAfter === deltaBefore);

  step("Case 3 — edges");
  const later = new Types.ObjectId();
  await deltaDb.collection("courses").insertOne({ _id: later, name: "New course", amount: 1000, status: "active" });
  delta = await planOf("delta");
  check("a course added to the CRM after the copy: listed, not set", delta?.root?.courses?.find((c: Json) => c.id === String(later))?.set === false);
  r = await call("PUT", `/commission-plans/delta/courses/${later}`, root, { sales: 100, tl: 0, sm: 0, creditUsd: 0 });
  check("…and can be set", r.status === 200 && r.body?.data?.find((p: Json) => p.code === "delta")?.root?.courses?.find((c: Json) => c.id === String(later))?.sales === 100);
  out = copy("--write");
  check("copying again leaves Root's plan and its edits", /already has this plan/.test(out.out)
    && (await mongoose.connection.db!.collection("commissionplans").findOne({ portal: "delta" }))?.salesManager?.name === "Lena", out.out.slice(-300));
  out = copy("--write", "--replace", "delta");
  const undo = fs.readdirSync(path.join(process.env.E2E_WORK!, "backups")).filter((f) => f.startsWith("commission-plan-delta-"));
  const back = await mongoose.connection.db!.collection("commissionplans").findOne({ portal: "delta" });
  check("--replace delta copies the CRM's again, Root's previous kept in an undo file", out.code === 0 && undo.length === 1 && back?.salesManager?.name === "Abrar"
    && JSON.parse(fs.readFileSync(path.join(process.env.E2E_WORK!, "backups", undo[0]!), "utf8")).salesManager.name === "Lena", out.out.slice(-300));

  step("Case 4 — errors");
  r = await call("PUT", `/commission-plans/draw/courses/${drawMbt}`, root, { sales: 230, tl: 50, sm: 85, creditUsd: 0 });
  check("Draw: a team leader paid on a sale → 400", r.status === 400 && /team leaders nothing/.test(r.body?.message ?? ""), show(r.body));
  r = await call("PUT", "/commission-plans/delta/slabs/sales", root, { rows: [{ name: "E", target: 10000, salary: 2000, percent: 0 }] });
  check("a slab whose first row isn't at 0 → 400", r.status === 400 && /base/.test(r.body?.message ?? ""), show(r.body));
  r = await call("PUT", "/commission-plans/delta/slabs/sales", root, { rows: [{ name: "Base", target: 0, salary: 1, percent: 0 }, { name: "A", target: 0, salary: 2, percent: 0 }] });
  check("…targets not rising → 400", r.status === 400 && /higher/.test(r.body?.message ?? ""), show(r.body));
  r = await call("PUT", "/commission-plans/delta/slabs/sales", root, { rows: [{ name: "Base", target: 0, salary: 1, percent: 120 }] });
  check("…a percent over 100 → 400", r.status === 400, show(r.body));
  r = await call("PUT", "/commission-plans/draw/slabs/tl", root, { rows: [{ name: "Base", target: 0, salary: 1, percent: 0 }] });
  check("Draw's TL slab (it has none) → 400", r.status === 400, show(r.body));
  r = await call("PUT", `/commission-plans/delta/courses/${new Types.ObjectId()}`, root, { sales: 1, tl: 0, sm: 0, creditUsd: 0 });
  check("an unknown course → 404", r.status === 404, show(r.body));
  r = await call("PUT", "/commission-plans/delta/settings", root, { salesManager: String(new Types.ObjectId()), excluded: [] });
  check("an unknown person → 400", r.status === 400, show(r.body));
  r = await call("PUT", "/commission-plans/delta/courses/x", root, { sales: -1, tl: 0, sm: 0, creditUsd: 0 });
  check("a negative amount → 400", r.status === 400, show(r.body));
  r = await call("PUT", `/commission-plans/remote/courses/${mbt}`, root, { sales: 1, tl: 0, sm: 0, creditUsd: 0 });
  check("Remote, never copied → 409", r.status === 409 && /not been copied/.test(r.body?.message ?? ""), show(r.body));
  r = await call("PUT", `/commission-plans/banglore/courses/${mbt}`, root, { sales: 1, tl: 0, sm: 0, creditUsd: 0 });
  check("Banglore, no plan → 404", r.status === 404, show(r.body));

  step("Case 5 — permission");
  check("no session → 401", (await call("GET", "/commission-plans")).status === 401);
  check("not a root admin → 403 (reading and editing)", (await call("GET", "/commission-plans", member)).status === 403
    && (await call("PUT", "/commission-plans/delta/settings", member, { salesManager: null, excluded: [] })).status === 403);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
