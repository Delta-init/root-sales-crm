import crypto from "node:crypto";
import { env } from "../config/env.js";

/**
 * Signed client for the HRMS directory.
 *
 * HRMS is where a person first exists: HR creates the employee, and everything
 * else follows from that. So the portal reads its people from there rather
 * than being a second place the same staff are typed in — two lists of one
 * workforce drift, and the one that drifts is the one nobody is looking at.
 * Email is what every handoff matches on, which makes a second spelling of an
 * address not a cosmetic problem but a person who cannot sign in.
 *
 * The canonical string must stay byte-identical to `buildCanonical` in the
 * HRMS repo. A mismatch surfaces as a blanket 401 with nothing to say which
 * field disagreed, because that server deliberately will not say.
 *
 *   METHOD \n PATH_WITH_QUERY \n TIMESTAMP \n NONCE \n sha256(body)
 */

const TIMEOUT_MS = 20_000;

export interface DirectoryEmployee {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  designation: string;
  employmentType: string;
  status: string;
  joiningDate: string | null;
  /** HRMS returns the id; the name is looked up separately. */
  departmentId: string | null;
}

export interface DirectoryDepartment {
  id: string;
  name: string;
  code: string;
  status: string;
}

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

export function hrmsConfigured(): boolean {
  return Boolean(
    env.HRMS_API_URL && env.HRMS_CLIENT_ID && env.HRMS_INTEGRATION_SECRET && env.HRMS_ORG_ID,
  );
}

/**
 * One signed GET.
 *
 * The signature covers the path *with* its query string, so it is built from
 * exactly the string that is then fetched — assembling the two separately is
 * how these drift, and the far end answers a blanket 401 that says nothing
 * about which field disagreed.
 */
async function signedGet<T>(
  signedPath: string,
): Promise<{ data?: T; pagination?: { total: number } }> {
  const baseUrl = env.HRMS_API_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString("hex");
  const bodyHash = crypto.createHash("sha256").update("").digest("hex");
  const canonical = ["GET", signedPath, timestamp, nonce, bodyHash].join("\n");
  const signature = crypto
    .createHmac("sha256", env.HRMS_INTEGRATION_SECRET)
    .update(canonical)
    .digest("hex");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${signedPath}`, {
      headers: {
        "Content-Type": "application/json",
        "X-Delta-Client": env.HRMS_CLIENT_ID,
        "X-Delta-Timestamp": timestamp,
        "X-Delta-Nonce": nonce,
        "X-Delta-Signature": signature,
      },
      signal: controller.signal,
    });

    if (res.status === 401) throw httpError("HRMS refused the portal's credentials", 502);
    if (!res.ok) throw httpError(`HRMS answered ${res.status}`, 502);

    return (await res.json()) as { data?: T; pagination?: { total: number } };
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err;
    throw httpError("HRMS could not be reached", 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Everybody HRMS knows about, in the organization this portal serves.
 *
 * Leavers are included and flagged rather than hidden: somebody who has left
 * still needs their access taken away, and dropping them from the feed would
 * strand an account nobody can see in order to close it.
 */
export async function listEmployees(): Promise<DirectoryEmployee[]> {
  if (!hrmsConfigured()) {
    throw httpError(
      "HRMS is not configured. Set HRMS_API_URL, HRMS_CLIENT_ID, HRMS_INTEGRATION_SECRET and HRMS_ORG_ID.",
      503,
    );
  }

  const all: DirectoryEmployee[] = [];
  let page = 1;

  /*
   * Paged, because the directory caps a call at 500 and an organization can be
   * larger than one page. Stopping at the first would quietly leave people out
   * of the list somebody is choosing from, which looks like they are not
   * employed here.
   */
  for (;;) {
    const qs = new URLSearchParams({
      organizationId: env.HRMS_ORG_ID,
      includeInactive: "true",
      page: String(page),
      limit: "200",
    }).toString();

    const body = await signedGet<DirectoryEmployee[]>(
      `/api/v1/integrations/directory/employees?${qs}`,
    );
    const rows = body.data ?? [];
    all.push(...rows);

    const total = body.pagination?.total ?? all.length;
    if (all.length >= total || rows.length === 0) break;
    page += 1;
  }

  return all;
}

/**
 * The departments of that same organization.
 *
 * Separate call because HRMS puts only the id on an employee. Without the
 * names, filtering a list of two hundred people by department would mean
 * choosing between object ids, which is no filter at all.
 *
 * Failure is the caller's to soften: a directory that loads without department
 * names is still worth showing, and is better than an error page because one
 * of two calls did not answer.
 */
export async function listDepartments(): Promise<DirectoryDepartment[]> {
  if (!hrmsConfigured()) {
    throw httpError("HRMS is not configured.", 503);
  }
  const qs = new URLSearchParams({ organizationId: env.HRMS_ORG_ID }).toString();
  const body = await signedGet<DirectoryDepartment[]>(
    `/api/v1/integrations/directory/departments?${qs}`,
  );
  return body.data ?? [];
}
