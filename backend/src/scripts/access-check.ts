/**
 * Checks who may open what, now that ordinary staff sign in here.
 *
 * The portal was a control tower: a handful of super admins, each able to open
 * everything, and nothing to decide. Once a rep signs in, two things have to be
 * true and neither is obvious from reading the code:
 *
 *   1. A member opens exactly what somebody wrote an access row for. A Banglore
 *      rep turning up in Delta's CRM is the failure this exists to prevent, and
 *      it would not announce itself — they would simply be in there.
 *   2. A member arrives as themselves. Every launch used to carry the org's
 *      shared service account, which is right for an administrator and wrong
 *      for a rep: their records would belong to "Root Admin" and the CRM would
 *      not know who had been in it.
 *
 * Scratch database only.
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/127\.0\.0\.1|localhost/.test(uri) || !/e2e|test|scratch/i.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch database, got "${uri}"`);
  process.exit(1);
}

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
function step(n: string) { console.log(`\n\x1b[1m${n}\x1b[0m`); }

await mongoose.connect(uri);
await mongoose.connection.dropDatabase();

const { AdminUser } = await import("../models/AdminUser.js");
const { Organization } = await import("../models/Organization.js");
const { Access } = await import("../models/Access.js");
const { accessService } = await import("../services/accessService.js");
const { ssoService } = await import("../services/ssoService.js");
const { SsoToken } = await import("../models/SsoToken.js");

/** The three CRMs, the two finance organizations and HRMS. */
const targets = [
  { code: "delta", kind: "crm", name: "Delta CRM" },
  { code: "banglore", kind: "crm", name: "Banglore CRM" },
  { code: "draw", kind: "crm", name: "Draw CRM" },
  { code: "finance-hq", kind: "finance", name: "Delta HQ Finance" },
  { code: "finance-banglore", kind: "finance", name: "Banglore Finance" },
  { code: "hrms", kind: "hrms", name: "Delta HRMS" },
] as const;

for (const t of targets) {
  await Organization.create({
    code: t.code, kind: t.kind, name: t.name,
    appUrl: `https://${t.code}.example.com`,
    apiUrl: `https://api-${t.code}.example.com`,
    timezone: "Asia/Dubai", currency: "AED", fxToBase: 1,
    serviceEmail: "root@deltainstitutions.com",
    isActive: true,
  });
}

const root = await AdminUser.create({
  name: "Root Admin", email: "root@e2e-test.com", password: "Password123!",
  role: "root_admin", status: "active",
});
const rep = await AdminUser.create({
  name: "Banglore Rep", email: "rep@e2e-test.com", password: "Password123!",
  role: "member", status: "active",
});
const viewer = await AdminUser.create({
  name: "Head Office", email: "viewer@e2e-test.com", password: "Password123!",
  role: "viewer", status: "active",
});

const session = (u: { _id: unknown; email: string; role: string }) =>
  ({ adminId: String(u._id), email: u.email, role: u.role }) as never;

step("Giving a rep exactly what they should have");
{
  await accessService.grant({
    userId: String(rep._id), target: "banglore",
    roleInTarget: "BDE", grantedBy: String(root._id),
  });
  await accessService.grant({
    userId: String(rep._id), target: "hrms",
    roleInTarget: "employee", grantedBy: String(root._id),
  });

  const mine = await accessService.listFor(String(rep._id));
  check("they hold two doors", mine.length === 2, `${mine.length}`);
  check("...their own CRM", mine.some((a) => a.target === "banglore"));
  check("...and HRMS, which everybody gets", mine.some((a) => a.target === "hrms"));

  // Granting the same door twice is the same grant.
  await accessService.grant({
    userId: String(rep._id), target: "banglore",
    roleInTarget: "BDE", grantedBy: String(root._id),
  });
  check("granting twice does not make a second row",
    (await Access.countDocuments({ user: rep._id, target: "banglore" })) === 1);
}

step("Letting them through their own door, and no other");
{
  const ok = await ssoService.launch(session(rep), "banglore", "127.0.0.1");
  check("a rep opens their own CRM", Boolean(ok.url), "no url");

  const minted = await SsoToken.findOne({ org: "banglore" }).sort({ createdAt: -1 });
  // The point of the whole change: they arrive as themselves.
  check("...arriving as themselves, not the service account",
    minted?.subjectEmail === "rep@e2e-test.com", `subject=${minted?.subjectEmail}`);
  check("...under their own name", minted?.subjectName === "Banglore Rep", `name=${minted?.subjectName}`);

  let refused = "";
  try { await ssoService.launch(session(rep), "delta", "127.0.0.1"); }
  catch (e) { refused = (e as Error).message; }
  check("a Banglore rep cannot open Delta's CRM", /do not have access/i.test(refused), `"${refused}"`);

  let noFinance = "";
  try { await ssoService.launch(session(rep), "finance-hq", "127.0.0.1"); }
  catch (e) { noFinance = (e as Error).message; }
  check("...nor finance, which nobody gave them", /do not have access/i.test(noFinance), `"${noFinance}"`);

  const hr = await ssoService.launch(session(rep), "hrms", "127.0.0.1");
  check("...but does reach HRMS", Boolean(hr.url), "no url");
}

step("Keeping the other two roles as they were");
{
  const anywhere = await ssoService.launch(session(root), "draw", "127.0.0.1");
  check("a root admin still opens anything, with no rows at all", Boolean(anywhere.url));
  const minted = await SsoToken.findOne({ org: "draw" }).sort({ createdAt: -1 });
  check("...still as the service account, as an administrator should",
    minted?.subjectEmail === "root@deltainstitutions.com", `subject=${minted?.subjectEmail}`);

  let viewerRefused = "";
  try { await ssoService.launch(session(viewer), "delta", "127.0.0.1"); }
  catch (e) { viewerRefused = (e as Error).message; }
  check("a viewer opens nothing", /do not have access/i.test(viewerRefused), `"${viewerRefused}"`);
}

step("Closing a door");
{
  await accessService.revoke(String(rep._id), "banglore");
  let after = "";
  try { await ssoService.launch(session(rep), "banglore", "127.0.0.1"); }
  catch (e) { after = (e as Error).message; }
  check("revoking shuts it immediately", /do not have access/i.test(after), `"${after}"`);

  // Deactivating somebody has to lock every door, not only the password one.
  await accessService.grant({
    userId: String(rep._id), target: "banglore",
    roleInTarget: "BDE", grantedBy: String(root._id),
  });
  await AdminUser.updateOne({ _id: rep._id }, { $set: { status: "inactive" } });
  let deactivated = "";
  try { await ssoService.launch(session(rep), "banglore", "127.0.0.1"); }
  catch (e) { deactivated = (e as Error).message; }
  check("a deactivated account opens nothing, access rows or not",
    /deactivated/i.test(deactivated), `"${deactivated}"`);
}

step("Granting and revoking, as the screen does it");
{
  const { record } = await import("../services/auditService.js");
  const { AuditLog } = await import("../models/AuditLog.js");

  // The audit entries the controller writes. Checked here because the enums
  // they must satisfy are a runtime check that no typecheck would catch — a
  // missing value fails only when somebody actually grants something.
  const req = {
    admin: { adminId: String(root._id), email: root.email },
    headers: {}, ip: "127.0.0.1", socket: {}, get: () => "",
  } as never;
  await record(req, "access_granted", {
    adminId: String(root._id), adminEmail: root.email, org: null,
    detail: "Granted rep@e2e-test.com access to Banglore CRM as BDE",
  });
  await record(req, "access_revoked", {
    adminId: String(root._id), adminEmail: root.email, org: null,
    detail: "Revoked rep@e2e-test.com's access to banglore",
  });
  await record(req, "portal_role_changed", {
    adminId: String(root._id), adminEmail: root.email, org: null,
    detail: "Set rep@e2e-test.com to member",
  });
  check("a grant is written to the audit log", (await AuditLog.countDocuments({ action: "access_granted" })) === 1);
  check("...a revoke too", (await AuditLog.countDocuments({ action: "access_revoked" })) === 1);
  check("...and a change of portal role", (await AuditLog.countDocuments({ action: "portal_role_changed" })) === 1);

  // A launch into finance has to be loggable, or every launch there throws.
  await record(req, "sso_launch", {
    adminId: String(root._id), adminEmail: root.email, org: "finance-hq",
    detail: "Launched into Delta HQ Finance",
  });
  check("a launch into finance can be logged", (await AuditLog.countDocuments({ org: "finance-hq" })) === 1);
}

await mongoose.disconnect();
console.log("");
if (failures) { console.log(`\x1b[31m${failures} of ${checks} checks failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mAll ${checks} checks passed\x1b[0m`);
