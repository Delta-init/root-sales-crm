import { readFileSync } from "node:fs";
import { Types } from "mongoose";
import { RewardGift, type IRewardGift } from "../models/RewardGift.js";
import { RewardSettings, type IRewardSettings } from "../models/RewardSettings.js";
import { RewardClaim, CLAIM_STATUSES, type ClaimStatus, type IRewardClaim } from "../models/RewardClaim.js";
import { Organization } from "../models/Organization.js";

/*
 * Gift rewards (the user, 2026-11-04): a salesperson who closes AED 50,000 in a month takes home a gift worth up to
 * AED 2,000; a team leader whose whole team closes AED 100,000, gifts worth up to AED 3,000. The four sales CRMs show
 * it as a pop-up with a wheel and a shelf of gifts. Root keeps what is the same for all of them: the targets, the
 * gifts with their photos, and every gift chosen, which the office buys and hands over from the Rewards page.
 *
 * What a person has closed is each CRM's to count, as its leaderboard counts it; Root checks what it is told against
 * the targets kept here and allows one gift a person a month.
 */

/** The sales CRMs that offer rewards. */
export const REWARD_PORTALS = ["delta", "draw", "remote", "banglore"] as const;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** A photo as it comes up, already shrunk on the Rewards page. */
const PHOTO_MAX_BYTES = 600 * 1024;

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/** This month in Dubai, YYYY-MM. */
export const dubaiMonth = (at = Date.now()): string => new Date(at + 4 * 3_600_000).toISOString().slice(0, 7);

/** The gifts Root starts with. Values are estimates for the office to correct on the Rewards page. */
const BUILT_IN = [
  { key: "airpods", name: "AirPods Pro", category: "Electronics", valueAed: 950, file: "airpods.jpg" },
  { key: "rayban-meta", name: "Ray-Ban Meta glasses", category: "Smart glasses", valueAed: 1_500, file: "rayban.jpg" },
  { key: "versace-watch", name: "Versace watch", category: "Watches", valueAed: 2_800, file: "watch.jpg" },
  { key: "handbag", name: "Designer handbag", category: "Handbags", valueAed: 1_800, file: "handbag.jpg" },
  { key: "sneakers", name: "Branded sneakers", category: "Shoes", valueAed: 700, file: "shoes.jpg" },
  { key: "cosmetics", name: "Cosmetics set", category: "Cosmetics", valueAed: 600, file: "cosmetics.jpg" },
  { key: "jewellery", name: "Gold jewellery", category: "Jewellery", valueAed: 2_000, file: "jewellery.jpg" },
  { key: "voucher", name: "Shopping gift voucher", category: "Gift vouchers", valueAed: 2_000, file: "voucher.jpg" },
  { key: "ferrari-world", name: "Ferrari World for two", category: "Experiences", valueAed: 700, file: "ferrari.jpg" },
  { key: "georgia-trip", name: "Georgia trip, flights for two", category: "Travel", valueAed: 2_600, file: "georgia.jpg" },
];

async function seedGifts(): Promise<void> {
  if ((await RewardGift.estimatedDocumentCount()) > 0) return;
  const docs = BUILT_IN.map((g, i) => ({
    seedKey: g.key, name: g.name, category: g.category, valueAed: g.valueAed, order: i, photoVersion: 1,
    photo: readFileSync(new URL(`../../static/rewards/${g.file}`, import.meta.url)), photoType: "image/jpeg",
  }));
  try {
    await RewardGift.insertMany(docs, { ordered: false });
  } catch (err) {
    // Another request put them in first: the unique seedKey turned these copies away.
    const e = err as { code?: number; writeErrors?: Array<{ code?: number }> };
    const duplicates = e.code === 11000 || (e.writeErrors?.length ? e.writeErrors.every((w) => w.code === 11000) : false);
    if (!duplicates) throw err;
  }
}

export type PublicSettings = Pick<IRewardSettings, "enabled" | "salesTargetAed" | "salesGiftAed" | "tlTargetAed" | "tlGiftAed" | "inrPerAed">;
const publicSettings = (s: IRewardSettings): PublicSettings => ({
  enabled: s.enabled, salesTargetAed: s.salesTargetAed, salesGiftAed: s.salesGiftAed,
  tlTargetAed: s.tlTargetAed, tlGiftAed: s.tlGiftAed, inrPerAed: s.inrPerAed,
});

/** The built-in gifts are known to be in, in this process. */
let seeded = false;

/** The one settings row, made on first use with the built-in gifts. */
export async function getSettings(): Promise<IRewardSettings> {
  const upsert = () =>
    RewardSettings.findOneAndUpdate({ key: "rewards" }, { $setOnInsert: { key: "rewards" } }, { upsert: true, new: true, setDefaultsOnInsert: true })
      .lean<IRewardSettings>();
  let s = await RewardSettings.findOne({ key: "rewards" }).lean<IRewardSettings | null>();
  // Two first requests at once: one makes the row, the other's insert hits the unique key and reads it.
  if (!s) s = await upsert().catch((err: { code?: number }) => (err.code === 11000 ? upsert() : Promise.reject(err)));
  if (!s!.seededAt && !seeded) {
    await seedGifts();
    await RewardSettings.updateOne({ key: "rewards", seededAt: null }, { $set: { seededAt: new Date() } });
  }
  seeded = true;
  return s!;
}

export async function saveSettings(input: Record<string, unknown>, by: string): Promise<PublicSettings> {
  const set: Partial<IRewardSettings> = { updatedBy: by };
  const money = (key: keyof PublicSettings, label: string, max = 100_000_000) => {
    if (input[key] === undefined) return;
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < 1 || n > max) throw fail(`${label} must be a number from 1 to ${max.toLocaleString("en-US")}`);
    (set as Record<string, number>)[key] = Math.round(n * 100) / 100;
  };
  money("salesTargetAed", "The salesperson target");
  money("salesGiftAed", "The salesperson gift value");
  money("tlTargetAed", "The team target");
  money("tlGiftAed", "The team leader gift value");
  money("inrPerAed", "The rupee rate", 1000);
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw fail("enabled must be true or false");
    set.enabled = input.enabled;
  }
  await getSettings();
  const s = await RewardSettings.findOneAndUpdate({ key: "rewards" }, { $set: set }, { new: true }).lean<IRewardSettings>();
  return publicSettings(s!);
}

// ── Gifts ─────────────────────────────────────────────────────────────────────

export interface GiftView {
  id: string;
  name: string;
  category: string;
  valueAed: number;
  active: boolean;
  order: number;
  /** 0 when it has no photo. */
  photoVersion: number;
}

const giftView = (g: Omit<IRewardGift, "photo">): GiftView => ({
  id: String(g._id), name: g.name, category: g.category, valueAed: g.valueAed, active: g.active, order: g.order,
  photoVersion: g.photoType ? g.photoVersion : 0,
});

async function gifts(activeOnly: boolean): Promise<GiftView[]> {
  await getSettings();
  const rows = await RewardGift.find(activeOnly ? { active: true } : {})
    .select("-photo")
    .sort({ order: 1, valueAed: 1, createdAt: 1 })
    .lean<Omit<IRewardGift, "photo">[]>();
  return rows.map(giftView);
}

function giftFields(input: Record<string, unknown>, partial: boolean): Partial<IRewardGift> {
  const out: Partial<IRewardGift> = {};
  const text = (key: "name" | "category", label: string, max: number) => {
    if (input[key] === undefined && partial) return;
    const v = String(input[key] ?? "").trim();
    if (!v || v.length > max) throw fail(`${label} is needed, up to ${max} characters`);
    out[key] = v;
  };
  text("name", "A name", 80);
  text("category", "A category", 40);
  if (input.valueAed !== undefined || !partial) {
    const n = Number(input.valueAed);
    if (!Number.isFinite(n) || n < 1 || n > 1_000_000) throw fail("The value must be an amount in AED from 1 to 1,000,000");
    out.valueAed = Math.round(n * 100) / 100;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw fail("active must be true or false");
    out.active = input.active;
  }
  if (input.order !== undefined) {
    const n = Number(input.order);
    if (!Number.isInteger(n) || n < 0 || n > 10_000) throw fail("order must be a whole number");
    out.order = n;
  }
  return out;
}

/** A photo sent as base64 (a data: URL or bare), checked for type and size. */
function decodePhoto(input: Record<string, unknown>): { photo: Buffer; photoType: string } {
  const raw = String(input.data ?? "");
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(raw);
  const type = String(m?.[1] ?? input.type ?? "").toLowerCase();
  if (!PHOTO_TYPES.includes(type)) throw fail("The photo must be a JPEG, PNG or WebP");
  const photo = Buffer.from(m ? m[2]! : raw, "base64");
  if (!photo.length) throw fail("The photo is empty");
  if (photo.length > PHOTO_MAX_BYTES) throw fail(`The photo is ${Math.round(photo.length / 1024)} KB; up to ${PHOTO_MAX_BYTES / 1024} KB fits`);
  return { photo, photoType: type };
}

export async function createGift(input: Record<string, unknown>): Promise<GiftView> {
  const fields = giftFields(input, false);
  const photo = input.photo && typeof input.photo === "object" ? decodePhoto(input.photo as Record<string, unknown>) : null;
  const last = await RewardGift.findOne().sort({ order: -1 }).select("order").lean<{ order: number } | null>();
  const doc = await RewardGift.create({ ...fields, order: fields.order ?? (last?.order ?? -1) + 1, ...(photo ?? {}), photoVersion: 1 });
  return giftView(doc.toObject());
}

export async function updateGift(id: string, input: Record<string, unknown>): Promise<GiftView> {
  if (!Types.ObjectId.isValid(id)) throw fail("No such gift", 404);
  const g = await RewardGift.findByIdAndUpdate(id, { $set: giftFields(input, true) }, { new: true, runValidators: true })
    .select("-photo").lean<Omit<IRewardGift, "photo">>();
  if (!g) throw fail("No such gift", 404);
  return giftView(g);
}

export async function setGiftPhoto(id: string, input: Record<string, unknown>): Promise<GiftView> {
  if (!Types.ObjectId.isValid(id)) throw fail("No such gift", 404);
  const { photo, photoType } = decodePhoto(input);
  const g = await RewardGift.findByIdAndUpdate(id, { $set: { photo, photoType }, $inc: { photoVersion: 1 } }, { new: true })
    .select("-photo").lean<Omit<IRewardGift, "photo">>();
  if (!g) throw fail("No such gift", 404);
  return giftView(g);
}

/** Gone for good when nobody has chosen it; otherwise only taken off the shelf, so those choices still say what it was. */
export async function removeGift(id: string): Promise<{ removed: boolean; hidden: boolean }> {
  if (!Types.ObjectId.isValid(id)) throw fail("No such gift", 404);
  if (await RewardClaim.exists({ giftId: new Types.ObjectId(id) })) {
    const g = await RewardGift.findByIdAndUpdate(id, { $set: { active: false } });
    if (!g) throw fail("No such gift", 404);
    return { removed: false, hidden: true };
  }
  const g = await RewardGift.findByIdAndDelete(id);
  if (!g) throw fail("No such gift", 404);
  return { removed: true, hidden: false };
}

export async function giftPhoto(id: string): Promise<{ photo: Buffer; type: string; version: number } | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const g = await RewardGift.findById(id).select("photo photoType photoVersion").lean<Pick<IRewardGift, "photo" | "photoType" | "photoVersion">>();
  if (!g?.photo || !g.photoType) return null;
  // A lean read gives Mongo's binary wrapper rather than a Buffer.
  const photo = Buffer.isBuffer(g.photo) ? g.photo : Buffer.from((g.photo as unknown as { buffer: ArrayBuffer }).buffer);
  return { photo, type: g.photoType, version: g.photoVersion };
}

// ── Claims ────────────────────────────────────────────────────────────────────

export interface ClaimView {
  id: string;
  portal: string;
  month: string;
  userId: string;
  userName: string;
  role: "sales" | "tl";
  teamName: string;
  achievedAed: number;
  achieved: number;
  currency: string;
  targetAed: number;
  giftId: string;
  giftName: string;
  giftCategory: string;
  giftValueAed: number;
  status: ClaimStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
  history: Array<{ status: ClaimStatus; at: string; by: string }>;
}

const claimView = (c: IRewardClaim): ClaimView => ({
  id: String(c._id), portal: c.portal, month: c.month, userId: c.userId, userName: c.userName, role: c.role,
  teamName: c.teamName, achievedAed: c.achievedAed, achieved: c.achieved, currency: c.currency, targetAed: c.targetAed,
  giftId: String(c.giftId), giftName: c.giftName, giftCategory: c.giftCategory, giftValueAed: c.giftValueAed,
  status: c.status, note: c.note, createdAt: new Date(c.createdAt).toISOString(), updatedAt: new Date(c.updatedAt).toISOString(),
  history: (c.history ?? []).map((h) => ({ status: h.status, at: new Date(h.at).toISOString(), by: h.by })),
});

export async function updateClaim(id: string, input: Record<string, unknown>, by: string): Promise<ClaimView> {
  if (!Types.ObjectId.isValid(id)) throw fail("No such gift request", 404);
  const claim = await RewardClaim.findById(id);
  if (!claim) throw fail("No such gift request", 404);
  if (input.status !== undefined) {
    const status = String(input.status) as ClaimStatus;
    if (!CLAIM_STATUSES.includes(status)) throw fail(`status must be one of ${CLAIM_STATUSES.join(", ")}`);
    if (status !== claim.status) {
      // Back from cancelled: only while the person hasn't chosen something else since.
      if (status !== "cancelled" && !claim.live) {
        const other = await RewardClaim.exists({ portal: claim.portal, month: claim.month, userId: claim.userId, live: true, _id: { $ne: claim._id } });
        if (other) throw fail(`${claim.userName || "They"} chose another gift after this one was cancelled`, 409);
      }
      claim.status = status;
      claim.live = status !== "cancelled";
      claim.history.push({ status, at: new Date(), by });
    }
  }
  if (input.note !== undefined) claim.note = String(input.note ?? "").trim().slice(0, 300);
  await claim.save();
  return claimView(claim.toObject());
}

// ── The Rewards page ──────────────────────────────────────────────────────────

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function rewardsOverview(month?: string) {
  const m = month && MONTH.test(month) ? month : dubaiMonth();
  const settings = await getSettings();
  const [all, claims, months, orgs] = await Promise.all([
    gifts(false),
    RewardClaim.find({ month: m }).sort({ createdAt: -1 }).lean<IRewardClaim[]>(),
    RewardClaim.distinct("month") as Promise<string[]>,
    Organization.find({ code: { $in: [...REWARD_PORTALS] } }).select("code name").lean<{ code: string; name: string }[]>(),
  ]);
  return {
    month: m,
    currentMonth: dubaiMonth(),
    months: [...new Set([dubaiMonth(), m, ...months])].sort().reverse(),
    settings: publicSettings(settings),
    gifts: all,
    claims: claims.map(claimView),
    portals: REWARD_PORTALS.map((code) => ({ code, name: orgs.find((o) => o.code === code)?.name ?? code })),
  };
}

// ── The CRMs ──────────────────────────────────────────────────────────────────

const forPortal = (portal: string) => {
  if (!(REWARD_PORTALS as readonly string[]).includes(portal)) throw fail("Gift rewards are only for the sales CRMs", 403);
};

/** What a CRM needs to show the pop-up: the targets, the gifts on the shelf, and this person's gift this month. */
export async function serviceRewards(portal: string, userId?: string) {
  forPortal(portal);
  const settings = await getSettings();
  const month = dubaiMonth();
  const claim = userId
    ? await RewardClaim.findOne({ portal, month, userId: String(userId).slice(0, 64), live: true }).lean<IRewardClaim | null>()
    : null;
  return { month, settings: publicSettings(settings), gifts: await gifts(true), claim: claim ? claimView(claim) : null };
}

/**
 * A gift chosen in a CRM. The CRM has counted the month and says who reached what; Root holds it to the targets kept
 * here, the gift to the tier's value, and the person to one gift this month.
 */
export async function serviceClaim(portal: string, input: Record<string, unknown>): Promise<ClaimView> {
  forPortal(portal);
  const s = await getSettings();
  if (!s.enabled) throw fail("Gift rewards are switched off at the moment", 409);
  const month = dubaiMonth();
  if (input.month !== month) throw fail("That month is over; gifts are chosen in the month they were reached", 409);
  const role = input.role === "tl" ? "tl" : input.role === "sales" ? "sales" : null;
  if (!role) throw fail("role must be sales or tl");
  const userId = String(input.userId ?? "").trim();
  if (!userId || userId.length > 64) throw fail("userId is needed");
  const achievedAed = Number(input.achievedAed);
  const targetAed = role === "tl" ? s.tlTargetAed : s.salesTargetAed;
  const capAed = role === "tl" ? s.tlGiftAed : s.salesGiftAed;
  if (!Number.isFinite(achievedAed) || achievedAed < targetAed) throw fail("The target isn't reached yet", 409);
  const giftId = String(input.giftId ?? "");
  if (!Types.ObjectId.isValid(giftId)) throw fail("No such gift", 404);
  const gift = await RewardGift.findById(giftId).select("-photo").lean<Omit<IRewardGift, "photo"> | null>();
  if (!gift || !gift.active) throw fail("That gift isn't on the shelf any more", 404);
  if (gift.valueAed > capAed) throw fail(`${gift.name} is worth more than this target's AED ${capAed.toLocaleString("en-US")}`, 409);
  try {
    const claim = await RewardClaim.create({
      portal, month, userId, role, targetAed,
      userName: String(input.userName ?? "").trim().slice(0, 120),
      teamName: String(input.teamName ?? "").trim().slice(0, 120),
      achievedAed: Math.round(achievedAed * 100) / 100,
      achieved: Math.round((Number(input.achieved) || achievedAed) * 100) / 100,
      currency: input.currency === "INR" ? "INR" : "AED",
      giftId: gift._id, giftName: gift.name, giftCategory: gift.category, giftValueAed: gift.valueAed,
      history: [{ status: "requested", at: new Date(), by: String(input.userName ?? "").trim().slice(0, 120) }],
    });
    return claimView(claim.toObject());
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw fail("You've already chosen your gift for this month", 409);
    throw err;
  }
}
