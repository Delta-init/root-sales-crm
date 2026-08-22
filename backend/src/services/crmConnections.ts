import mongoose, { type Connection } from "mongoose";
import { Organization } from "../models/Organization.js";
import type { IOrganization } from "../types/index.js";

/**
 * Lazily-opened, cached connections to the three CRM databases.
 *
 * These are READ-ONLY by convention and by credential: the group report only
 * ever aggregates. Nothing here defines a model with a write path, and the
 * connection strings should belong to read-only Mongo users.
 *
 * Connections are cached because opening one per request would exhaust the
 * pool under a dashboard that fires several panels at once.
 */
const pool = new Map<string, Connection>();

export interface CrmSource {
  org: IOrganization;
  conn: Connection;
}

const openConnection = async (uri: string): Promise<Connection> => {
  const conn = mongoose.createConnection(uri, {
    // Fail fast. A report panel waiting 30s on an unreachable host is worse
    // than a panel that says "Draw is unavailable" in two.
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 5,
  });
  await conn.asPromise();
  return conn;
};

/**
 * Resolve every active org to a live connection.
 *
 * A failure is returned, not thrown: if Banglore's host is down, the report
 * should still show Delta and Draw with an explicit note, rather than 500 and
 * show nothing at all.
 */
export const getSources = async (): Promise<{
  sources: CrmSource[];
  failures: { code: string; name: string; error: string }[];
}> => {
  const orgs = await Organization.find({ isActive: true })
    .select("+mongoUri")
    .sort({ sortOrder: 1 });

  const sources: CrmSource[] = [];
  const failures: { code: string; name: string; error: string }[] = [];

  await Promise.all(
    orgs.map(async (org) => {
      if (!org.mongoUri) {
        failures.push({
          code: org.code,
          name: org.name,
          error: "No database URI configured",
        });
        return;
      }

      try {
        let conn = pool.get(org.code);
        if (!conn || conn.readyState !== 1) {
          conn = await openConnection(org.mongoUri);
          pool.set(org.code, conn);
        }
        sources.push({ org, conn });
      } catch (error) {
        pool.delete(org.code);
        failures.push({
          code: org.code,
          name: org.name,
          error: error instanceof Error ? error.message : "Connection failed",
        });
      }
    })
  );

  sources.sort((a, b) => a.org.sortOrder - b.org.sortOrder);
  return { sources, failures };
};

export const closeAll = async (): Promise<void> => {
  await Promise.all([...pool.values()].map((c) => c.close()));
  pool.clear();
};
