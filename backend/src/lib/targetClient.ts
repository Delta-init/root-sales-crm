import { Organization } from "../models/Organization.js";
import { targetConfig, missingFor } from "../config/targets.js";

/**
 * Talking to one of the systems this portal fronts.
 *
 * Provisioning grew its own copy of all this — find the registry row, check
 * it is configured, trim the base URL, carry the secret, interpret the
 * refusal. Three more calls were about to grow a fourth copy each, so it
 * lives here once.
 *
 * Every call fails closed. A target with no address or no secret is a 503
 * saying which is missing, never a call made without one and never a silent
 * success that did nothing.
 */

const TIMEOUT_MS = 15_000;

export const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

interface Envelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: { message?: string };
}

export interface ResolvedTarget {
  code: string;
  name: string;
  base: string;
  secret: string;
  remoteOrgId: string;
}

/**
 * The registry row, checked, with its secret.
 *
 * Kept separate from the call itself because the callers want the name for
 * their error messages and the remoteOrgId for their query strings, and
 * fetching the row twice to get them would be worse.
 */
export async function resolveTarget(code: string): Promise<ResolvedTarget> {
  // The database still says what a system is; the environment says how to
  // reach it. Both have to agree that it exists and is in use.
  const org = await Organization.findOne({ code }).select("code name isActive");
  if (!org) throw httpError(`Unknown target: ${code}`, 404);
  if (!org.isActive) throw httpError(`${org.name} is not active`, 409);

  const missing = missingFor(code, ["apiUrl", "ssoSecret"]);
  if (missing.length) {
    throw httpError(
      `${org.name} is not configured on this server — set ${missing.join(" and ")}`,
      503,
    );
  }

  const cfg = targetConfig(code);
  return {
    code: org.code,
    name: org.name,
    base: cfg.apiUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, ""),
    secret: cfg.ssoSecret,
    remoteOrgId: cfg.remoteOrgId,
  };
}

/**
 * One service call, with the target's own refusal preserved.
 *
 * When a target says no it usually knows exactly why — an unknown role, an
 * account that is not a member, a name its own validation rejects. Replacing
 * that with a generic failure would throw away the only useful sentence, so
 * the target's message is carried through with its name in front of it.
 */
export async function callTarget<T>(
  target: ResolvedTarget,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; verb?: string } = { method: "GET" },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const verb = init.verb ?? "answer";

  try {
    const res = await fetch(`${target.base}/api/v1/service${path}`, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        "x-portal-secret": target.secret,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => ({}))) as Envelope<T>;

    if (!res.ok) {
      const why = body.error?.message ?? body.message ?? `refused with ${res.status}`;
      /*
       * A bad secret is this portal's problem, not the administrator's: it
       * means the registry is misconfigured, so it is reported as a bad
       * gateway rather than as though they had asked for something invalid.
       */
      throw httpError(`${target.name} would not ${verb}: ${why}`, res.status === 401 ? 502 : 409);
    }
    if (body.data === undefined) throw httpError(`${target.name} returned nothing`, 502);
    return body.data;
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err;
    throw httpError(`${target.name} could not be reached`, 502);
  } finally {
    clearTimeout(timer);
  }
}
