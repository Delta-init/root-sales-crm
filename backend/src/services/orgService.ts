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
  // What kind of system it is. The dashboard labels and illustrates each card
  // from this; without it every entry read "Organisation" and offered to
  // "Open CRM", including the two finance organizations and HRMS.
  kind: org.kind ?? "crm",
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
   * The systems one person should be shown, and whether they can be opened.
   *
   * This used to be `list()` for everybody, which meant a member signing in
   * saw the whole estate — every system's name, currency and local time,
   * including the ones they would never open — and an "Open" button on none
   * of them. The list told them nothing true and the buttons lied.
   *
   * A root admin still sees everything: they administer it, and they arrive
   * as the service account rather than as themselves.
   *
   * A viewer sees none. Their whole definition is the group report and no
   * doors, and an account somewhere else does not change that — the role is
   * the decision, and it was made deliberately.
   *
   * A member sees what they are actually on. Not what was granted: a grant is
   * a note this portal wrote, and the question a member is asking is "where
   * can I go", which only the systems themselves can answer. Somebody with an
   * account in a CRM can already sign into that CRM with their own password,
   * so a portal that refuses to send them there protects nothing and costs
   * them a tab.
   *
   * `reach` is the honest state of each card, and the three values are three
   * different facts rather than shades of one:
   *
   *   open        — the system says they have an account there
   *   pending     — granted here, but no account exists yet to arrive at
   *   unavailable — the system could not be asked, so nobody knows
   *
   * A system that could not be asked is shown rather than dropped, but only
   * where a grant says it belongs to this person. Dropping it would make an
   * outage look exactly like access being taken away, which is the ticket
   * nobody wants to answer; showing it to everybody would list the estate to
   * people who have nothing to do with it every time a server hiccups. The
   * gap is somebody holding an account nobody granted, on a system that is
   * down: their card disappears until it answers again.
   */
  async listForAdmin(admin: { adminId: string; email: string; role: string }) {
    const orgs = await Organization.find({ isActive: true }).sort({ sortOrder: 1 });

    if (admin.role === "root_admin") {
      return orgs.map((o) => ({ ...toPublic(o), reach: "open" as const, note: null as string | null }));
    }
    if (admin.role !== "member") return [];

    const email = admin.email.toLowerCase().trim();
    const { directoryService } = await import("./directoryService.js");
    const { Access } = await import("../models/Access.js");

    const [{ platforms, presence }, grants] = await Promise.all([
      directoryService.presenceFor([email]),
      Access.find({ user: admin.adminId }).select("target").lean(),
    ]);

    const on = presence[email] ?? {};
    const granted = new Set(grants.map((g) => String(g.target)));
    const silent = new Map(
      platforms.filter((p) => p.unreachable).map((p) => [String(p.target), p.unreachable as string]),
    );

    const mine: (ReturnType<typeof toPublic> & { reach: "open" | "pending" | "unavailable"; note: string | null })[] = [];
    for (const org of orgs) {
      const code = String(org.code);
      if (on[code]) {
        mine.push({ ...toPublic(org), reach: "open", note: null });
      } else if (silent.has(code) && granted.has(code)) {
        mine.push({ ...toPublic(org), reach: "unavailable", note: silent.get(code) ?? null });
      } else if (granted.has(code)) {
        mine.push({ ...toPublic(org), reach: "pending", note: "No account here yet" });
      }
    }
    return mine;
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
