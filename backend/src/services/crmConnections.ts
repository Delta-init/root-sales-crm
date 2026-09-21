import mongoose, { type Connection } from "mongoose";
import { Organization } from "../models/Organization.js";
import { targetConfig, envKeyFor } from "../config/targets.js";
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
 * Resolve every active sales CRM to a live connection.
 *
 * Sales CRMs and nothing else. This asked for every active org, which was
 * right while the registry held nothing but CRMs and quietly wrong once it
 * held Finance, HRMS, the LMS and Media ERP: the group report and the daily
 * tracker were opening connections to all four and asking them for leads and
 * calls. The lucky answer was an empty column and a line in `failures`; the
 * unlucky one was a collection whose name happened to match.
 *
 * It matters twice over, because rep sign-in resolves its sources the same
 * way — so a rep's password was being offered to the HRMS and LMS databases
 * on its way to finding the CRM the rep actually works in.
 *
 * `kind` is the registry's own word for what a system is, and the bootstrap
 * seed sets it on every run, so this needs no second list to be kept in step.
 *
 * A failure is returned, not thrown: if Banglore's host is down, the report
 * should still show Delta and Draw with an explicit note, rather than 500 and
 * show nothing at all.
 */
export const getSources = async (): Promise<{
  sources: CrmSource[];
  failures: { code: string; name: string; error: string }[];
}> => {
  const orgs = await Organization.find({ isActive: true, kind: "crm" }).sort({ sortOrder: 1 });

  const sources: CrmSource[] = [];
  const failures: { code: string; name: string; error: string }[] = [];

  await Promise.all(
    orgs.map(async (org) => {
      // The connection string lives in the environment, not in this
      // database. Naming the variable saves whoever sees this a search.
      const uri = targetConfig(org.code).mongoUri;
      if (!uri) {
        failures.push({
          code: org.code,
          name: org.name,
          error: `No database URI configured — set ${envKeyFor(org.code)}_MONGODB_URI`,
        });
        return;
      }

      try {
        let conn = pool.get(org.code);
        if (!conn || conn.readyState !== 1) {
          conn = await openConnection(uri);
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
