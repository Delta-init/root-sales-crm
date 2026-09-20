/**
 * Print the environment variables for what is currently in the registry.
 *
 * Addresses and secrets used to live on the organization documents. They live
 * in the environment now, which means an existing deployment has values in its
 * database that nothing reads any more — and if they are not moved across
 * before the next deploy, every target becomes unreachable at once.
 *
 * So this reads the old fields straight off the raw documents, without going
 * through the model (which no longer declares them), and prints them as
 * variables ready to paste.
 *
 *   bun run src/scripts/registry-to-env.ts
 *
 * Nothing is written and nothing is deleted. Once the variables are in place
 * and the portal is working, the stale fields can be dropped with --clean,
 * which is a separate decision and a separate run.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { envKeyFor } from "../config/targets.js";

const clean = process.argv.includes("--clean");

const OLD_FIELDS = [
  "appUrl", "apiUrl", "mongoUri", "ssoSecret", "remoteOrgId", "serviceEmail",
] as const;
const VAR_SUFFIX: Record<(typeof OLD_FIELDS)[number], string> = {
  appUrl: "APP_URL",
  apiUrl: "API_URL",
  mongoUri: "MONGODB_URI",
  ssoSecret: "SSO_SECRET",
  remoteOrgId: "REMOTE_ORG_ID",
  serviceEmail: "SERVICE_EMAIL",
};

const run = async () => {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database connection");

  // Read raw: the model no longer declares these fields, so a normal find()
  // would return documents with every value stripped out.
  const docs = await db
    .collection("organizations")
    .find({}, { sort: { sortOrder: 1 } })
    .toArray();

  if (!docs.length) {
    console.log("No organizations registered — nothing to move.");
    await mongoose.disconnect();
    return;
  }

  const lines: string[] = [];
  let found = 0;

  for (const doc of docs) {
    const code = String(doc["code"] ?? "");
    if (!code) continue;
    const key = envKeyFor(code);

    const present = OLD_FIELDS.filter((f) => String(doc[f] ?? "").trim());
    if (!present.length) continue;

    found += present.length;
    lines.push(`# ${doc["name"] ?? code}`);
    for (const f of present) {
      lines.push(`${key}_${VAR_SUFFIX[f]}=${String(doc[f]).trim()}`);
    }
    lines.push("");
  }

  if (!found) {
    console.log("Nothing left in the database to move — the environment is already the only source.");
  } else {
    console.log(
      "\n# ─── Move these into the portal's .env, then restart it ───\n" +
        "# Printed from the registry documents. Treat this output as secret.\n",
    );
    console.log(lines.join("\n"));
  }

  if (clean) {
    if (!found) {
      console.log("Nothing to clean.");
    } else {
      /*
       * Only ever the five fields that moved, by name. Unsetting anything
       * else here would be deleting business data to tidy up configuration.
       */
      const unset = Object.fromEntries(OLD_FIELDS.map((f) => [f, ""]));
      const res = await db.collection("organizations").updateMany({}, { $unset: unset });
      console.log(`\nRemoved the stale fields from ${res.modifiedCount} document(s).`);
    }
  } else if (found) {
    console.log(
      "\n# The database still holds these. Once the portal works from the\n" +
        "# environment, run again with --clean to remove them.",
    );
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
