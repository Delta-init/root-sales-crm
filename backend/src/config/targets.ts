/**
 * Where each system lives, and the credentials for reaching it.
 *
 * This used to be in the database. The addresses and secrets were set in the
 * environment, copied into Mongo by the bootstrap seed, and then editable
 * from a Registry screen — so there were two sources of truth and the one
 * being edited was the copy. Change a secret in the environment and the
 * portal kept using the stale value in the database; change it in the screen
 * and the next deploy could quietly put the old one back.
 *
 * So the environment is the only source now, read directly. Nothing about
 * reaching another system is stored, which also means a dump of this
 * database no longer contains a single service credential or connection
 * string.
 *
 * What stays in the database is what a system *is* to the business — its
 * name, currency, timezone, exchange rate, colour, ordering. Those are
 * editable, they differ per organization rather than per deployment, and
 * none of them open anything.
 *
 * Read from process.env directly rather than through the validated schema,
 * on purpose: adding a system then needs no code change at all, only the
 * variables for it.
 */

/** `finance-hq` → `FINANCE_HQ`, matching the names already in use. */
export const envKeyFor = (code: string) => code.toUpperCase().replace(/-/g, "_");

export interface TargetConfig {
  /** Where to send a browser. */
  appUrl: string;
  /** Where to send a service call. */
  apiUrl: string;
  /** Read directly, for the group report and the daily tracker. */
  mongoUri: string;
  /** Shared secret, both directions. */
  ssoSecret: string;
  /** Which organization inside that system, where it holds more than one. */
  remoteOrgId: string;
  /** The account this portal signs in as when a root admin launches. */
  serviceEmail: string;
}

const read = (key: string) => (process.env[key] ?? "").trim();

export function targetConfig(code: string): TargetConfig {
  const k = envKeyFor(code);
  return {
    appUrl: read(`${k}_APP_URL`),
    apiUrl: read(`${k}_API_URL`),
    mongoUri: read(`${k}_MONGODB_URI`),
    ssoSecret: read(`${k}_SSO_SECRET`),
    remoteOrgId: read(`${k}_REMOTE_ORG_ID`),
    serviceEmail: read(`${k}_SERVICE_EMAIL`).toLowerCase(),
  };
}

/**
 * What is missing before this system can be used for a given purpose.
 *
 * Named rather than counted, because "finance-hq is not configured" sends
 * somebody to read code and "finance-hq has no FINANCE_HQ_SSO_SECRET" does
 * not.
 */
export function missingFor(code: string, need: (keyof TargetConfig)[]): string[] {
  const cfg = targetConfig(code);
  const k = envKeyFor(code);
  const varName: Record<keyof TargetConfig, string> = {
    appUrl: `${k}_APP_URL`,
    apiUrl: `${k}_API_URL`,
    mongoUri: `${k}_MONGODB_URI`,
    ssoSecret: `${k}_SSO_SECRET`,
    remoteOrgId: `${k}_REMOTE_ORG_ID`,
    serviceEmail: `${k}_SERVICE_EMAIL`,
  };
  return need.filter((f) => !cfg[f]).map((f) => varName[f]);
}

/**
 * Every secret this portal will accept from another system.
 *
 * Inbound calls prove themselves with one of these. Blank values are
 * dropped — an unset variable must never become a secret that matches an
 * empty header.
 */
export function allServiceSecrets(codes: string[]): { code: string; secret: string }[] {
  return codes
    .map((code) => ({ code, secret: targetConfig(code).ssoSecret }))
    .filter((e) => e.secret.length > 0);
}
