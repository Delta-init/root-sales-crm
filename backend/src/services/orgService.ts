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

export const orgService = {
  async list() {
    const orgs = await Organization.find({ isActive: true }).sort({ sortOrder: 1 });
    return orgs.map(toPublic);
  },

  /** Internal use only — includes the secrets. Never hand the result to a route. */
  async getWithSecrets(code: string) {
    return Organization.findOne({ code }).select("+mongoUri +ssoSecret");
  },
};
