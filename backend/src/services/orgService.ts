import { Organization } from "../models/Organization.js";
import type { IOrganization } from "../types/index.js";

/**
 * Whitelist of fields safe to send to the browser.
 *
 * mongoUri and ssoSecret are select:false on the schema, but this function is
 * the belt to that pair of braces: the shape returned here is built by naming
 * fields, not by stripping them, so a future field added to the model is
 * private by default rather than public by accident.
 */
export const toPublic = (org: IOrganization) => ({
  id: org._id.toString(),
  code: org.code,
  name: org.name,
  appUrl: org.appUrl,
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
export const toAdmin = (org: IOrganization & { mongoUri?: string; ssoSecret?: string }) => ({
  id: org._id.toString(),
  code: org.code,
  kind: org.kind ?? "crm",
  name: org.name,
  appUrl: org.appUrl,
  apiUrl: org.apiUrl,
  timezone: org.timezone,
  currency: org.currency,
  fxToBase: org.fxToBase,
  serviceEmail: org.serviceEmail,
  remoteOrgId: org.remoteOrgId,
  accent: org.accent,
  isActive: org.isActive,
  sortOrder: org.sortOrder,
  hasMongoUri: Boolean(org.mongoUri),
  hasSsoSecret: Boolean(org.ssoSecret),
});

/** Fields an administrator may write. Code is not among them — see update(). */
const WRITABLE = [
  "kind", "name", "appUrl", "apiUrl", "timezone", "currency",
  "fxToBase", "serviceEmail", "remoteOrgId", "accent", "isActive", "sortOrder",
] as const;

/** Written when given, never returned. Blank means "leave what is there". */
const SECRETS = ["mongoUri", "ssoSecret"] as const;

export const orgService = {
  /** Everything, switched off included. Administrators only. */
  async listAll() {
    const orgs = await Organization.find({})
      .select("+mongoUri +ssoSecret")
      .sort({ sortOrder: 1, name: 1 });
    return orgs.map((o) => toAdmin(o as unknown as IOrganization & { mongoUri?: string; ssoSecret?: string }));
  },

  async create(input: Record<string, unknown>) {
    const code = String(input["code"] ?? "").trim();
    if (!code) throw Object.assign(new Error("code is required"), { statusCode: 400 });
    if (await Organization.findOne({ code })) {
      throw Object.assign(new Error(`${code} is already registered`), { statusCode: 409 });
    }

    const doc: Record<string, unknown> = { code };
    for (const f of WRITABLE) if (input[f] !== undefined) doc[f] = input[f];
    for (const f of SECRETS) if (String(input[f] ?? "").trim()) doc[f] = input[f];

    const org = await Organization.create(doc);
    return toAdmin(org as unknown as IOrganization & { mongoUri?: string; ssoSecret?: string });
  },

  /**
   * Change a registered target.
   *
   * The code is not writable. It is what access rows, audit entries and the
   * three CRMs all refer to a target by, and renaming it here would leave
   * every one of those pointing at something that no longer exists — silently,
   * because they hold the string rather than a reference.
   *
   * A blank secret leaves the stored one alone, so somebody editing the name
   * does not have to retype a connection string they cannot see.
   */
  async update(code: string, input: Record<string, unknown>) {
    const org = await Organization.findOne({ code }).select("+mongoUri +ssoSecret");
    if (!org) throw Object.assign(new Error(`Unknown target: ${code}`), { statusCode: 404 });

    for (const f of WRITABLE) if (input[f] !== undefined) (org as unknown as Record<string, unknown>)[f] = input[f];
    for (const f of SECRETS) {
      if (String(input[f] ?? "").trim()) (org as unknown as Record<string, unknown>)[f] = input[f];
    }
    await org.save();
    return toAdmin(org as unknown as IOrganization & { mongoUri?: string; ssoSecret?: string });
  },

  async list() {
    const orgs = await Organization.find({ isActive: true }).sort({ sortOrder: 1 });
    return orgs.map(toPublic);
  },

  /** Internal use only — includes the secrets. Never hand the result to a route. */
  async getWithSecrets(code: string) {
    return Organization.findOne({ code }).select("+mongoUri +ssoSecret");
  },
};
