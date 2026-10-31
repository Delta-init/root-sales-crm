/**
 * Copy each sales CRM's commission plan into Root (the user, 2026-11-01: one plan, kept in Root, edited there).
 *
 *   bun run src/scripts/commission-plan-copy.ts            # dry run: what would be copied, nothing written
 *   bun run src/scripts/commission-plan-copy.ts --write    # copies the plans Root doesn't have yet
 *   bun run src/scripts/commission-plan-copy.ts --write --replace delta   # copies one again over Root's, saving Root's to an undo file
 *
 * Reads the Sales CRM, Draw and Remote databases (courses, commission settings, users) and writes only to Root's own
 * database, the commissionplans collection. Nothing in a CRM changes: they keep counting with their own plan until
 * they are switched to ask Root.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { getSources, closeAll } from "../services/crmConnections.js";
import { CommissionPlan } from "../models/CommissionPlan.js";
import { isPortal, planFromCrm, slabsInForce, uaeMonth } from "../services/commissionPlanService.js";

const write = process.argv.includes("--write");
const replaceAt = process.argv.indexOf("--replace");
const replace = replaceAt > 0 ? process.argv[replaceAt + 1] ?? "" : "";

const run = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(write ? "WRITING to Root's database" : "Dry run — nothing is written. Add --write to copy.");
  const { sources, failures } = await getSources();
  for (const f of failures) if (isPortal(f.code)) console.log(`\n${f.name}: can't be read — ${f.error}`);
  for (const src of sources) {
    const code = src.org.code;
    if (!isPortal(code)) continue;
    const plan = await planFromCrm(src);
    const existing = await CommissionPlan.findOne({ portal: code }).lean();
    const month = uaeMonth();
    const now = slabsInForce(plan.slabs, month);
    console.log(`\n${src.org.name} (${code})`);
    console.log(`  courses: ${plan.courses.length}, ${plan.courses.filter((c) => c.sales || c.tl || c.sm).length} paying commission`);
    for (const c of plan.courses.filter((c) => c.sales || c.tl || c.sm || c.creditUsd)) {
      console.log(`    ${c.name}: sales ${c.sales}, TL ${c.tl}, SM ${c.sm}, credit $${c.creditUsd}`);
    }
    console.log(`  team leaders: ${plan.tlRule}${plan.tlSlab ? ", with their own slab" : ", on the Sales Staff slab"}${plan.tlPaidOnOwnClose ? ", paid the TL line on their own close" : ""}`);
    console.log(`  Sales Manager: ${plan.salesManager?.name ?? "none"}; earn nothing: ${plan.excluded.map((p) => p.name).join(", ") || "no one"}`);
    console.log(`  slab versions: ${plan.slabs.map((v) => v.from).join(", ")}; in force ${month}: from ${now?.from}`);
    for (const role of ["sales", "tl", "sm"] as const) {
      if (role === "tl" && !plan.tlSlab) continue;
      console.log(`    ${role}: ${(now?.[role] ?? []).map((r) => `${r.name} ${r.target} → ${r.salary} + ${r.percent}%`).join(" | ")}`);
    }
    if (existing && replace !== code) {
      console.log(`  Root already has this plan (copied ${existing.copiedAt?.toISOString() ?? "?"}) — left as it is.`);
      continue;
    }
    if (!write) {
      console.log(existing ? "  would be copied again over Root's" : "  would be copied");
      continue;
    }
    if (existing) {
      const dir = path.resolve("backups");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `commission-plan-${code}-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(existing, null, 2));
      console.log(`  Root's previous plan saved to ${file}`);
    }
    await CommissionPlan.findOneAndUpdate(
      { portal: code },
      { $set: { ...plan, copiedAt: new Date(), updatedByEmail: "copied from the CRM" } },
      { upsert: true, runValidators: true },
    );
    console.log("  copied to Root");
  }
  await closeAll();
  await mongoose.disconnect();
};

run().catch(async (e) => {
  console.error(e);
  await closeAll().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
