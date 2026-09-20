/**
 * Idempotent bootstrap: creates the root admin and the three org registry rows.
 * Safe to re-run — existing rows are updated in place, never duplicated, and an
 * existing admin's password is left alone.
 *
 *   bun run seed
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDB } from "../config/db.js";
import { AdminUser } from "../models/AdminUser.js";
import { Organization } from "../models/Organization.js";
import { missingFor } from "../config/targets.js";
import type { OrgCode } from "../types/index.js";

/**
 * What each system is to the business.
 *
 * Every known system is seeded, including ones nobody has configured yet, so
 * a row always exists and the environment alone decides whether a system can
 * actually be reached. That is what makes configuring one a matter of setting
 * variables rather than filling in a form: there is no row to create.
 */
interface OrgSeed {
  code: OrgCode;
  kind: "crm" | "finance" | "hrms";
  name: string;
  timezone: string;
  currency: string;
  fxToBase: number;
  accent: string;
  sortOrder: number;
}

const orgSeeds = (): OrgSeed[] => [
  {
    code: "delta",
    kind: "crm",
    name: "Delta",
    timezone: "Asia/Dubai",
    currency: "AED",
    fxToBase: 1,
    accent: "#2563eb",
    sortOrder: 1,
  },
  {
    code: "banglore",
    kind: "crm",
    name: "Banglore",
    timezone: "Asia/Kolkata",
    currency: "INR",
    fxToBase: Number(env.INR_TO_AED),
    accent: "#16a34a",
    sortOrder: 2,
  },
  {
    code: "draw",
    kind: "crm",
    name: "Delta Draw",
    timezone: "Asia/Dubai",
    currency: "AED",
    fxToBase: 1,
    accent: "#c026d3",
    sortOrder: 3,
  },
  {
    code: "finance-hq",
    kind: "finance",
    name: "Delta HQ Finance",
    timezone: "Asia/Dubai",
    currency: "AED",
    fxToBase: 1,
    accent: "#ea580c",
    sortOrder: 4,
  },
  {
    code: "finance-banglore",
    kind: "finance",
    name: "Banglore Finance",
    timezone: "Asia/Kolkata",
    currency: "INR",
    fxToBase: Number(env.INR_TO_AED),
    accent: "#ea580c",
    sortOrder: 5,
  },
  {
    code: "hrms",
    kind: "hrms",
    name: "Delta HRMS",
    timezone: "Asia/Dubai",
    currency: "AED",
    fxToBase: 1,
    accent: "#0891b2",
    sortOrder: 6,
  },
];

const run = async () => {
  await connectDB();

  const existing = await AdminUser.findOne({ email: env.ROOT_ADMIN_EMAIL.toLowerCase() });
  if (existing) {
    console.log(`admin   ${existing.email} — already exists, password untouched`);
  } else {
    await AdminUser.create({
      name: env.ROOT_ADMIN_NAME,
      email: env.ROOT_ADMIN_EMAIL,
      password: env.ROOT_ADMIN_PASSWORD, // hashed by the pre-save hook
      role: "root_admin",
      status: "active",
    });
    console.log(`admin   ${env.ROOT_ADMIN_EMAIL} — created`);
    if (env.ROOT_ADMIN_PASSWORD === "ChangeMe@12345") {
      console.warn("        ⚠  default password in use — change it before deploying");
    }
  }

  for (const seed of orgSeeds()) {
    const { code, ...rest } = seed;

    /*
     * Only what a system is to the business. How to reach it is read from
     * the environment at the moment it is needed rather than copied in here,
     * so there is one source of truth and this seed cannot overwrite it with
     * a stale value from a partial .env.
     */
    const update: Record<string, unknown> = { ...rest, code };

    await Organization.findOneAndUpdate(
      { code },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Reported by variable name: "banglore is missing apiUrl" sends somebody
    // to read code, "BANGLORE_API_URL is unset" does not.
    const missing = missingFor(code, ["appUrl", "apiUrl", "ssoSecret", "serviceEmail"]);

    console.log(
      `org     ${code.padEnd(9)} ${seed.currency}  ${seed.timezone.padEnd(14)}` +
        (missing.length ? `  ⚠ missing: ${missing.join(", ")}` : "  ✓")
    );
  }

  await mongoose.disconnect();
  console.log("\nBootstrap complete.");
};

run().catch((error) => {
  console.error("Bootstrap failed:", error);
  process.exit(1);
});
