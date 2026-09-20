import { Organization } from "../models/Organization.js";
import type { IOrganization } from "../types/index.js";
import { targetConfig, envKeyFor, missingFor } from "../config/targets.js";

/**
 * Whitelist of fields safe to send to the browser.
 *
 * Built by naming fields rather than by stripping them, so a field added to
 * the model tomorrow is private by default rather than public by accident.
 */
export const toPublic = (org: IOrganization) => ({
  id: org._id.toString(),
  code: org.code,
  name: org.name,
  appUrl: targetConfig(org.code).appUrl,
  timezone: org.timezone,
  currency: org.currency,
  accent: org.accent,
  dataStartsAt: org.dataStartsAt,
  isActive: org.isActive,
  sortOrder: org.sortOrder,
});

/**
 * The registry as an administrator needs to see it.
 *
 * Wider than `toPublic` — an admin has to see the API address, the service
 * account and whether a target is switched off — but built the same way, by
 * naming fields rather than stripping them, so a field added to the model
 * tomorrow is private until somebody decides otherwise.
 *
 * The two secrets are reported as set or not set, never returned. Somebody
 * configuring a target needs to know whether there is a connection string
 * behind it; nobody needs to read it back out of the screen, and a value that
 * is never sent cannot leak from one.
 */
export const toAdmin = (org: IOrganization) => {
  /*
   * How this system is reached is reported, never returned.
   *
   * The values live in the environment and this says which of them are set,
   * plus the variable names to set the missing ones. An address is not a
   * secret, so it is shown; the connection string and the shared secret are
   * only ever "set" or "not set", because nobody needs to read those back out
   * of a screen and a value that is never sent cannot leak from one.
   */
  const cfg = targetConfig(org.code);
  return {
    id: org._id.toString(),
    code: org.code,
    kind: org.kind ?? "crm",
    name: org.name,
    timezone: org.timezone,
    currency: org.currency,
    fxToBase: org.fxToBase,
    serviceEmail: cfg.serviceEmail,
    accent: org.accent,
    isActive: org.isActive,
    sortOrder: org.sortOrder,

    envPrefix: envKeyFor(org.code),
    appUrl: cfg.appUrl,
    apiUrl: cfg.apiUrl,
    remoteOrgId: cfg.remoteOrgId,
    hasMongoUri: Boolean(cfg.mongoUri),
    hasSsoSecret: Boolean(cfg.ssoSecret),
    /** What is still unset, by variable name, so nobody has to go and look. */
    missing: missingFor(org.code, ["appUrl", "apiUrl", "ssoSecret", "serviceEmail"]),
  };
};

/**
 * Fields an administrator may write.
 *
 * The code is not among them — see update(). Neither are the addresses, the
 * database URI, the shared secret or the remote organization id: those are
 * the environment's to set, and a screen that could edit them would be
 * editing a copy the next deploy overwrites.
 */
const WRITABLE = [
  "kind", "name", "timezone", "currency",
  "fxToBase", "accent", "isActive", "sortOrder",
] as const;

export const orgService = {
  /** Everything, switched off included. Administrators only. */
  async listAll() {
    const orgs = await Organization.find({}).sort({ sortOrder: 1, name: 1 });
    return orgs.map((o) => toAdmin(o as unknown as IOrganization));
  },

  async create(input: Record<string, unknown>) {
    const code = String(input["code"] ?? "").trim();
    if (!code) throw Object.assign(new Error("code is required"), { statusCode: 400 });
    if (await Organization.findOne({ code })) {
      throw Object.assign(new Error(`${code} is already registered`), { statusCode: 409 });
    }

    const doc: Record<string, unknown> = { code };
    for (const f of WRITABLE) if (input[f] !== undefined) doc[f] = input[f];

    const org = await Organization.create(doc);
    return toAdmin(org as unknown as IOrganization);
  },

  /**
   * Change a registered target.
   *
   * The code is not writable. It is what access rows, audit entries and the
   * three CRMs all refer to a target by, and renaming it here would leave
   * every one of those pointing at something that no longer exists — silently,
   * because they hold the string rather than a reference.
   *
   * Addresses and secrets are not writable here at all. They come from the
   * environment, so a field posted for one is ignored rather than stored
   * somewhere that looks authoritative and is not.
   */
  async update(code: string, input: Record<string, unknown>) {
    const org = await Organization.findOne({ code });
    if (!org) throw Object.assign(new Error(`Unknown target: ${code}`), { statusCode: 404 });

    for (const f of WRITABLE) if (input[f] !== undefined) (org as unknown as Record<string, unknown>)[f] = input[f];
    await org.save();
    return toAdmin(org as unknown as IOrganization);
  },

  async list() {
    const orgs = await Organization.find({ isActive: true }).sort({ sortOrder: 1 });
    return orgs.map(toPublic);
  },

  /**
   * The record, for internal callers.
   *
   * Kept under its old name so callers do not all change at once, but it no
   * longer carries anything secret — there is nothing secret left on the
   * document to carry.
   */
  async getWithSecrets(code: string) {
    return Organization.findOne({ code });
  },
};
