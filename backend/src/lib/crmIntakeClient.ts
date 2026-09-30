import { targetConfig, envKeyFor } from "../config/targets.js";

/**
 * Posting leads into a CRM through its own sheet intake.
 *
 * The same door the lead sheets used before the portal stood in front of them —
 * `POST /api/v1/sheets/sync/batch` with the CRM's sheet key — so each CRM goes
 * on doing exactly what it did with a sheet's leads: the same duplicate check,
 * the same fields, and the same sharing out across its own teams. The portal
 * decides which CRM; the CRM still decides which person.
 *
 * The address is the one the registry already uses for that system; the key
 * is `{CODE}_SHEETS_API_KEY`, read from the environment like every other
 * setting of a system, so it is never stored or sent to a browser.
 */

const TIMEOUT_MS = 20_000;

export interface IntakeRow {
  full_name: string;
  phone_number: string;
  platform: string;
  source: string;
  email?: string;
  ad_creative?: string;
  campaign_name?: string;
  created_time?: string;
  id?: string;
  is_organic?: string;
  reporter?: string;
  assigned_to?: string;
}

export interface IntakeResult {
  index: number;
  status: "created" | "duplicate" | "invalid";
  leadId?: string;
  reason?: string;
}

export const sheetsKeyVar = (code: string) => `${envKeyFor(code)}_SHEETS_API_KEY`;

/** Where a CRM's intake is, and what is missing before it can be used. */
export function intakeConfig(code: string): { base: string; key: string; missing: string[] } {
  const base = targetConfig(code).apiUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  const key = (process.env[sheetsKeyVar(code)] ?? "").trim();
  const missing = [
    ...(base ? [] : [`${envKeyFor(code)}_API_URL`]),
    ...(key ? [] : [sheetsKeyVar(code)]),
  ];
  return { base, key, missing };
}

/**
 * One batch into one CRM, answered lead by lead.
 *
 * Throws when the CRM could not be reached or refused the whole batch; the
 * caller keeps those leads and tries again. A lead the CRM looked at and
 * turned down comes back as `invalid` in the results instead.
 */
export async function postIntakeBatch(code: string, rows: IntakeRow[]): Promise<IntakeResult[]> {
  const { base, key, missing } = intakeConfig(code);
  if (missing.length) throw new Error(`not configured on this server — set ${missing.join(" and ")}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/v1/sheets/sync/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ rows }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      data?: { results?: IntakeResult[] };
    };
    if (!res.ok || body.success === false) {
      throw new Error(`answered ${res.status}: ${body.message ?? "no message"}`);
    }
    if (!Array.isArray(body.data?.results)) throw new Error("answered without per-lead results");
    return body.data!.results!;
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error(`did not answer within ${TIMEOUT_MS / 1000}s`);
    if (error instanceof TypeError) throw new Error(`could not be reached (${error.message})`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
