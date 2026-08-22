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
import type { OrgCode } from "../types/index.js";

interface OrgSeed {
  code: OrgCode;
  name: string;
  appUrl: string;
  apiUrl: string;
  mongoUri: string;
  ssoSecret: string;
  timezone: string;
  currency: string;
  fxToBase: number;
  accent: string;
  sortOrder: number;
}

const orgSeeds = (): OrgSeed[] => [
  {
    code: "delta",
    name: "Delta",
    appUrl: env.DELTA_APP_URL,
    apiUrl: env.DELTA_API_URL,
    mongoUri: env.DELTA_MONGODB_URI,
    ssoSecret: env.DELTA_SSO_SECRET,
    timezone: "Asia/Dubai",
    currency: "AED",
    fxToBase: 1,
    accent: "#2563eb",
    sortOrder: 1,
  },
  {
    code: "banglore",
    name: "Banglore",
    appUrl: env.BANGLORE_APP_URL,
    apiUrl: env.BANGLORE_API_URL,
    mongoUri: env.BANGLORE_MONGODB_URI,
    ssoSecret: env.BANGLORE_SSO_SECRET,
    timezone: "Asia/Kolkata",
    currency: "INR",
    fxToBase: Number(env.INR_TO_AED),
    accent: "#16a34a",
    sortOrder: 2,
  },
  {
    code: "draw",
    name: "Delta Draw",
    appUrl: env.DRAW_APP_URL,
    apiUrl: env.DRAW_API_URL,
    mongoUri: env.DRAW_MONGODB_URI,
    ssoSecret: env.DRAW_SSO_SECRET,
    timezone: "Asia/Dubai",
    currency: "AED",
    fxToBase: 1,
    accent: "#c026d3",
    sortOrder: 3,
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

    // Only overwrite secrets when this run actually supplies them, so a seed
    // run with a partial .env cannot blank out credentials already stored.
    const update: Record<string, unknown> = { ...rest, code };
    if (!seed.mongoUri) delete update.mongoUri;
    if (!seed.ssoSecret) delete update.ssoSecret;

    await Organization.findOneAndUpdate(
      { code },
      { $set: update, $setOnInsert: { serviceEmail: env.ROOT_ADMIN_EMAIL.toLowerCase() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const missing = [
      !seed.appUrl && "appUrl",
      !seed.apiUrl && "apiUrl",
      !seed.mongoUri && "mongoUri",
      !seed.ssoSecret && "ssoSecret (Phase 2)",
    ].filter(Boolean);

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
