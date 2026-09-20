/**
 * Seeds a local sandbox: a root admin, a member, and the registry pointing at
 * a finance server running on this machine.
 *
 * Scratch database only. The point of it is that the real portal's database
 * holds real people and a real registry — trying the identity provider by
 * granting yourself access in production is not trying it, it is doing it.
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/127\.0\.0\.1|localhost/.test(uri)) {
  console.error(`Refusing to seed: MONGODB_URI must be local, got "${uri}"`);
  process.exit(1);
}

await mongoose.connect(uri);

const { AdminUser } = await import("../models/AdminUser.js");
const { Organization } = await import("../models/Organization.js");
const { Access } = await import("../models/Access.js");

await Promise.all([
  AdminUser.deleteMany({}),
  Organization.deleteMany({}),
  Access.deleteMany({}),
]);

const FINANCE_API = process.env.LOCAL_FINANCE_API ?? "http://localhost:4000";
const FINANCE_APP = process.env.LOCAL_FINANCE_APP ?? "http://localhost:3000";
const SECRET = process.env.LOCAL_PORTAL_SECRET ?? "local-sandbox-portal-secret";
const FINANCE_ORG_ID = process.env.LOCAL_FINANCE_ORG_ID ?? "";

const root = await AdminUser.create({
  name: "Root Admin",
  email: "root@local.test",
  password: "Password123!",
  role: "root_admin",
  status: "active",
});

const member = await AdminUser.create({
  name: "Yamini",
  email: "yamini@local.test",
  password: "Password123!",
  role: "member",
  status: "active",
});

/* The finance organization on the local finance server, as a target. */
await Organization.create({
  code: "finance-hq",
  kind: "finance",
  name: "Delta HQ Finance (local)",
  appUrl: FINANCE_APP,
  apiUrl: FINANCE_API,
  timezone: "Asia/Dubai",
  currency: "AED",
  fxToBase: 1,
  serviceEmail: "root@local.test",
  remoteOrgId: FINANCE_ORG_ID,
  ssoSecret: SECRET,
  isActive: true,
  sortOrder: 1,
});

/*
 * Only finance is registered. A row for a CRM that is not running would look
 * launchable and fail on the click, which is a worse first impression than an
 * honest list of one — and the registry screen names the missing systems at
 * the top anyway, which is the thing worth seeing.
 */

console.log(`
  Portal seeded.

    root admin   root@local.test     Password123!
    member       yamini@local.test   Password123!

  The member has NO access yet — that is the thing to try:
  sign in as the root admin, open Access, and give them finance.
`);

void member;
void root;
await mongoose.disconnect();
