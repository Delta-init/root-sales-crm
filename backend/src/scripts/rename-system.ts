/**
 * Rename one system on the dashboard.
 *
 * The cards show the name stored on the organization, and the bootstrap seed
 * only sets it when it is run — so a system renamed in the code (Tetra
 * Commission → CS Portal, 2026-10-28) keeps its old name on a live database
 * until it is changed here. There is no screen for it.
 *
 *   bun run src/scripts/rename-system.ts --code=commission --name="CS Portal"
 *   bun run src/scripts/rename-system.ts --code=commission --name="CS Portal" --write
 *
 * Shows what it would change and writes nothing without --write. Undo by
 * running it again with the old name.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Organization } from "../models/Organization.js";

const arg = (key: string) => process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3).trim() ?? "";
const code = arg("code"), name = arg("name");
const write = process.argv.includes("--write");

const run = async () => {
  if (!code || !name) throw new Error('Usage: --code=<system code> --name="<new name>" [--write]');
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ code });
  if (!org) throw new Error(`No system with code "${code}"`);
  if (org.name === name) {
    console.log(`${code}: already "${name}" — nothing to do`);
  } else if (!write) {
    console.log(`${code}: "${org.name}" → "${name}"  (dry run — add --write to change it)`);
  } else {
    const before = org.name;
    org.name = name;
    await org.save();
    console.log(`${code}: "${before}" → "${name}"  ✓ written`);
  }
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
