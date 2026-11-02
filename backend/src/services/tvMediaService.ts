import { randomUUID } from "node:crypto";
import { TvMedia, TvScreen, type ITvMedia } from "../models/TvMedia.js";
import { tvMediaStore, tvStoreMissing } from "../lib/tvMediaStore.js";

/**
 * The office TVs' photos and videos (2026-11-02, "every TV we can apply the photos on the root, 1 min interval, first
 * show the photos then the actual thing"). Root admins upload them on the TV media page and say which TVs show them;
 * every TV plays its own list, then its board for `boardSeconds` (a minute), and again (static/tv-overlay.js).
 */

/** Every public TV, by the key its page names in the overlay's link. */
export const TV_SCREENS = [
  { key: "root-sales-tv", name: "Sales TV", where: "Root" },
  { key: "root-manager-tv", name: "Manager TV", where: "Root" },
  { key: "sales-crm", name: "Leaderboard", where: "Sales CRM" },
  { key: "draw", name: "Leaderboard", where: "Draw" },
  { key: "remote", name: "Leaderboard", where: "Remote" },
  { key: "banglore", name: "Leaderboard", where: "Banglore" },
  { key: "cs-dubai", name: "CS TV — Dubai", where: "CS Portal" },
  { key: "cs-bangalore", name: "CS TV — Bangalore", where: "CS Portal" },
  { key: "hrms-board", name: "Pod board", where: "HRMS" },
] as const;
const SCREEN_KEYS = new Set<string>(TV_SCREENS.map((s) => s.key));

export const LIMITS = {
  image: { types: ["image/jpeg", "image/png", "image/webp", "image/gif"], maxBytes: 10 * 1024 * 1024 },
  video: { types: ["video/mp4", "video/webm"], maxBytes: 200 * 1024 * 1024 },
} as const;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm" };
const DEFAULT_BOARD_SECONDS = 60;

const bad = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
const kindOf = (mime: string): "image" | "video" | null =>
  (LIMITS.image.types as readonly string[]).includes(mime) ? "image" : (LIMITS.video.types as readonly string[]).includes(mime) ? "video" : null;

/** Today in Dubai, YYYY-MM-DD. */
export const dubaiToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function screensFrom(allScreens: unknown, screens: unknown): { allScreens: boolean; screens: string[] } {
  if (allScreens !== false) return { allScreens: true, screens: [] };
  const list = Array.isArray(screens) ? [...new Set(screens.map(String))] : [];
  const unknown = list.filter((s) => !SCREEN_KEYS.has(s));
  if (unknown.length) throw bad(`No such TV: ${unknown.join(", ")}`);
  if (!list.length) throw bad("Choose at least one TV, or all of them");
  return { allScreens: false, screens: list };
}

function daysFrom(fromDay: unknown, toDay: unknown) {
  const f = typeof fromDay === "string" ? fromDay.trim() : "";
  const t = typeof toDay === "string" ? toDay.trim() : "";
  if ((f && !DAY.test(f)) || (t && !DAY.test(t))) throw bad("Dates are YYYY-MM-DD");
  if (f && t && t < f) throw bad("The last day is before the first");
  return { fromDay: f, toDay: t };
}

const seconds = (n: unknown) => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 3 || v > 300) throw bad("A photo stays up between 3 and 300 seconds");
  return v;
};

/** Shown on a TV today: switched on, inside its dates, meant for it. */
const showingOn = (m: Pick<ITvMedia, "active" | "fromDay" | "toDay" | "allScreens" | "screens">, screen: string, today: string) =>
  m.active && (!m.fromDay || m.fromDay <= today) && (!m.toDay || m.toDay >= today) && (m.allScreens || m.screens.includes(screen));

function view(m: ITvMedia, today: string) {
  let url = "";
  try { url = tvMediaStore.viewLink(m.key); } catch { /* not set up: the page says so */ }
  return {
    id: String(m._id), kind: m.kind, name: m.name, mime: m.mime, size: m.size, durationSec: m.durationSec, seconds: m.seconds,
    allScreens: m.allScreens, screens: m.screens, order: m.order, active: m.active, fromDay: m.fromDay, toDay: m.toDay,
    showingToday: m.active && (!m.fromDay || m.fromDay <= today) && (!m.toDay || m.toDay >= today),
    addedBy: m.addedBy, createdAt: m.createdAt, url,
  };
}

async function screenSettings() {
  const saved = new Map((await TvScreen.find({}).lean()).map((s) => [s.key, s]));
  return TV_SCREENS.map((s) => ({
    ...s, boardSeconds: saved.get(s.key)?.boardSeconds ?? DEFAULT_BOARD_SECONDS, enabled: saved.get(s.key)?.enabled ?? true,
  }));
}

/** The TV media page: every photo and video in order, every TV with its timing and what it shows today. */
export async function tvMediaOverview() {
  const today = dubaiToday();
  const media = await TvMedia.find({}).sort({ order: 1, createdAt: 1 }).lean<ITvMedia[]>();
  const screens = (await screenSettings()).map((s) => {
    const mine = media.filter((m) => showingOn(m, s.key, today));
    return {
      ...s,
      showing: mine.length,
      // One round of photos and videos, for "a break lasts about…".
      breakSeconds: mine.reduce((t, m) => t + (m.kind === "image" ? m.seconds : Math.round(m.durationSec || 0)), 0),
    };
  });
  return { media: media.map((m) => view(m, today)), screens, limits: LIMITS, storeMissing: tvStoreMissing(), today };
}

/** A signed link to upload one file to, after checking it's a photo or video of an allowed size. */
export async function startUpload(input: { name?: unknown; mime?: unknown; size?: unknown }) {
  const mime = String(input.mime ?? "").toLowerCase();
  const kind = kindOf(mime);
  if (!kind) throw bad("Only JPG, PNG, WebP or GIF photos and MP4 or WebM videos");
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) throw bad("The file is empty");
  if (size > LIMITS[kind].maxBytes) throw bad(`A ${kind === "image" ? "photo" : "video"} can be at most ${mb(LIMITS[kind].maxBytes)}`);
  const key = `tv/${dubaiToday().slice(0, 7)}/${randomUUID()}.${EXT[mime]}`;
  return { key, uploadUrl: tvMediaStore.uploadLink(key, mime), headers: { "Content-Type": mime } };
}

/** The uploaded file, put on the TVs: last in the order, switched on. */
export async function addMedia(input: Record<string, unknown>, by: string) {
  const key = String(input.key ?? "");
  if (!/^tv\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm)$/.test(key)) throw bad("Not an upload from this page");
  if (await TvMedia.exists({ key })) throw bad("That file is on the TVs already");
  const mime = String(input.mime ?? "").toLowerCase();
  const kind = kindOf(mime);
  if (!kind || EXT[mime] !== key.split(".").pop()) throw bad("The file's type doesn't match its upload");
  const size = await tvMediaStore.size(key);
  if (size === null) throw bad("The upload didn't arrive — try again");
  if (size > LIMITS[kind].maxBytes) {
    await tvMediaStore.remove(key).catch(() => {});
    throw bad(`A ${kind === "image" ? "photo" : "video"} can be at most ${mb(LIMITS[kind].maxBytes)}`);
  }
  const last = await TvMedia.findOne({}).sort({ order: -1 }).select("order").lean();
  const doc = await TvMedia.create({
    kind, key, mime, size,
    name: String(input.name ?? "").trim().slice(0, 200) || key.split("/").pop(),
    durationSec: kind === "video" ? Math.max(0, Math.round(Number(input.durationSec) || 0)) : 0,
    seconds: kind === "image" && input.seconds !== undefined ? seconds(input.seconds) : 10,
    ...screensFrom(input.allScreens, input.screens),
    ...daysFrom(input.fromDay, input.toDay),
    order: (last?.order ?? 0) + 1,
    active: true,
    addedBy: by,
  });
  return view(doc.toObject() as ITvMedia, dubaiToday());
}

export async function updateMedia(id: string, input: Record<string, unknown>) {
  const doc = await TvMedia.findById(id);
  if (!doc) throw bad("No such photo or video", 404);
  if (input.name !== undefined) doc.name = String(input.name).trim().slice(0, 200) || doc.name;
  if (input.seconds !== undefined) doc.seconds = seconds(input.seconds);
  if (input.active !== undefined) doc.active = input.active === true;
  if (input.allScreens !== undefined || input.screens !== undefined) {
    Object.assign(doc, screensFrom(input.allScreens ?? doc.allScreens, input.screens ?? doc.screens));
  }
  if (input.fromDay !== undefined || input.toDay !== undefined) {
    Object.assign(doc, daysFrom(input.fromDay ?? doc.fromDay, input.toDay ?? doc.toDay));
  }
  await doc.save();
  return view(doc.toObject() as ITvMedia, dubaiToday());
}

/** The whole order at once: `ids` first to last; anything left out keeps its place after them. */
export async function reorderMedia(ids: unknown) {
  if (!Array.isArray(ids) || !ids.length) throw bad("Nothing to put in order");
  const all = await TvMedia.find({}).sort({ order: 1, createdAt: 1 }).select("_id").lean();
  const given = ids.map(String);
  const rest = all.map((m) => String(m._id)).filter((id) => !given.includes(id));
  const known = new Set(all.map((m) => String(m._id)));
  const order = [...given.filter((id) => known.has(id)), ...rest];
  await TvMedia.bulkWrite(order.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: i + 1 } } } })));
  return { order };
}

/** Off every TV and out of the bucket. */
export async function removeMedia(id: string) {
  const doc = await TvMedia.findById(id);
  if (!doc) throw bad("No such photo or video", 404);
  await tvMediaStore.remove(doc.key).catch(() => {});
  await doc.deleteOne();
  return { id };
}

export async function saveScreen(key: string, input: { boardSeconds?: unknown; enabled?: unknown }, by: string) {
  if (!SCREEN_KEYS.has(key)) throw bad("No such TV", 404);
  const set: Record<string, unknown> = { updatedBy: by };
  if (input.boardSeconds !== undefined) {
    const v = Math.round(Number(input.boardSeconds));
    if (!Number.isFinite(v) || v < 10 || v > 3600) throw bad("The board stays up between 10 seconds and an hour");
    set.boardSeconds = v;
  }
  if (input.enabled !== undefined) set.enabled = input.enabled === true;
  await TvScreen.updateOne({ key }, { $set: set, $setOnInsert: { key } }, { upsert: true });
  return (await screenSettings()).find((s) => s.key === key);
}

/**
 * What one TV plays, for its page's overlay — open, no sign-in: only the files' links and timing. A TV switched off
 * here, or with nothing for it today, gets an empty list and shows its board as before.
 */
export async function playlist(screen: string) {
  if (!SCREEN_KEYS.has(screen)) throw bad("No such TV", 404);
  const today = dubaiToday();
  const s = (await screenSettings()).find((x) => x.key === screen)!;
  const media = s.enabled ? await TvMedia.find({ active: true }).sort({ order: 1, createdAt: 1 }).lean<ITvMedia[]>() : [];
  const items: Array<{ id: string; kind: "image" | "video"; url: string; seconds: number; durationSec: number }> = [];
  if (!tvStoreMissing().length) {
    for (const m of media.filter((x) => showingOn(x, screen, today))) {
      items.push({ id: String(m._id), kind: m.kind, url: tvMediaStore.viewLink(m.key), seconds: m.seconds, durationSec: m.durationSec });
    }
  }
  return { screen, enabled: s.enabled, boardSeconds: s.boardSeconds, items, refreshSeconds: 120 };
}
