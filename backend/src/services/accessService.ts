import { Access } from "../models/Access.js";
import type { IAccess, TargetCode } from "../types/index.js";

/**
 * Who may open what.
 *
 * Every question about a person's reach is answered from rows, never from
 * their role, their email domain or which system created them. Those all look
 * like reasonable shortcuts and each is one rename away from opening a door
 * nobody decided to open.
 */
export const accessService = {
  /** One person's right to one target, or null. */
  async find(userId: string, target: string): Promise<IAccess | null> {
    return Access.findOne({ user: userId, target: target as TargetCode });
  },

  /** Everything one person may open. */
  async listFor(userId: string): Promise<IAccess[]> {
    return Access.find({ user: userId }).sort({ target: 1 });
  },

  /**
   * Give somebody a door, or change what they are once through it.
   *
   * Upserted rather than inserted: granting twice is the same grant, and a
   * second row would make a later revoke look like it had worked while one
   * remained.
   */
  async grant(input: {
    userId: string;
    target: TargetCode;
    roleInTarget: string;
    grantedBy: string;
  }): Promise<IAccess> {
    const row = await Access.findOneAndUpdate(
      { user: input.userId, target: input.target },
      {
        $set: { roleInTarget: input.roleInTarget, grantedBy: input.grantedBy },
        $setOnInsert: { user: input.userId, target: input.target },
      },
      { new: true, upsert: true }
    );
    return row!;
  },

  /**
   * What else a grant implies.
   *
   * A BDE in a sales CRM is a salesperson in finance, so giving somebody the
   * first should give them the second — that is the whole point of writing the
   * rule down. Returned rather than applied here so the caller can say what it
   * is about to do: access appearing that nobody asked for is alarming even
   * when it is correct, and especially then.
   *
   * An existing grant for the same target is left alone. Somebody deliberately
   * made a salesperson an accountant once; a rule should not quietly put that
   * back on the next unrelated grant.
   */
  async implied(input: {
    userId: string;
    target: TargetCode;
    roleInTarget: string;
  }): Promise<{ target: TargetCode; roleInTarget: string }[]> {
    const { RoleMap } = await import("../models/RoleMap.js");
    const rules = await RoleMap.find({
      fromTarget: input.target,
      fromRole: input.roleInTarget.trim().toLowerCase(),
    }).lean();
    if (rules.length === 0) return [];

    const held = new Set(
      (await Access.find({ user: input.userId }).select("target").lean()).map((a) => String(a.target)),
    );
    return rules
      .filter((r) => !held.has(String(r.toTarget)))
      .map((r) => ({ target: r.toTarget as TargetCode, roleInTarget: r.toRole }));
  },

  async revoke(userId: string, target: TargetCode): Promise<boolean> {
    const { deletedCount } = await Access.deleteOne({ user: userId, target });
    return (deletedCount ?? 0) > 0;
  },
};
