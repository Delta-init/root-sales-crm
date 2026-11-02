/**
 * The office TVs' photos and videos (2026-11-02), against a scratch database and an R2 stand-in
 * (run by scripts/tv-media-check.sh):
 *
 *   1. root admins only; uploads refused for the wrong type or too big, before and after the file goes up;
 *   2. a photo for every TV, a video for two, one from tomorrow, one switched off — each TV's open playlist has what's
 *      meant for it today, in order, readable from another site, with a link that stays the same between calls;
 *   3. a TV's timing and switch, the order, a photo's seconds and TVs changed;
 *   4. the overlay script other portals load; the rest of the API still only answers its own sites;
 *   5. removed: off the TVs and out of the bucket.
 */
import mongoose from "mongoose";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${uri}"`);
  process.exit(1);
}
const BASE = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const ROOT = `${BASE}/api/v1`;
const R2_DIR = process.env.E2E_R2_DIR ?? "";
const PASSWORD = "TvMediaE2e!pass1";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 600);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(method: string, p: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; body: Json; headers: Headers }> {
  const r = await fetch(`${ROOT}${p}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
}
const inBucket = () => (existsSync(R2_DIR) ? readdirSync(R2_DIR, { recursive: true }).map(String).filter((f) => /\.(png|jpg|mp4|webm|webp|gif)$/.test(f)) : []);

async function main() {
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const { AdminUser } = await import("../models/AdminUser.js");
  await AdminUser.create({ name: "Root E2E", email: "root@tv-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@tv-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const login = async (email: string) => {
    const r = await fetch(`${ROOT}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
    return ((await r.json()) as Json).data?.accessToken as string;
  };
  const root = { authorization: `Bearer ${await login("root@tv-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@tv-e2e.test")}` };
  const fromCrm = { origin: "https://crm.example.test" };

  /** Upload a file the way the page does: ask for a link, PUT the bytes, then put it on the TVs. */
  const upload = async (name: string, mime: string, bytes: number, extra: Record<string, unknown> = {}, declared = bytes) => {
    const start = await call("POST", "/tv-media/uploads", root, { name, mime, size: declared });
    if (start.status !== 200) return { start, put: 0, add: null as Json };
    const put = await fetch(start.body.data.uploadUrl, { method: "PUT", headers: start.body.data.headers, body: new Uint8Array(bytes) });
    const add = await call("POST", "/tv-media", root, { key: start.body.data.key, name, mime, size: declared, ...extra });
    return { start, put: put.status, add };
  };

  step("1. Who may, and what may go up");
  check("not signed in: refused", (await call("GET", "/tv-media")).status === 401);
  check("somebody who isn't a root admin: refused", (await call("GET", "/tv-media", member)).status === 403
    && (await call("POST", "/tv-media/uploads", member, { name: "x.png", mime: "image/png", size: 10 })).status === 403);
  let r = await call("GET", "/tv-media", root);
  check("the page: nothing yet, every TV listed at a minute, storage set up", r.status === 200 && r.body.data.media.length === 0
    && r.body.data.screens.length === 9 && r.body.data.screens.every((s: Json) => s.boardSeconds === 60 && s.enabled) && r.body.data.storeMissing.length === 0, show(r.body.data?.screens?.[0]));
  check("a PDF: refused", (await call("POST", "/tv-media/uploads", root, { name: "a.pdf", mime: "application/pdf", size: 100 })).status === 400);
  check("a photo over 10 MB, a video over 200 MB: refused before they go up",
    (await call("POST", "/tv-media/uploads", root, { name: "big.jpg", mime: "image/jpeg", size: 11 * 1024 * 1024 })).status === 400
    && (await call("POST", "/tv-media/uploads", root, { name: "big.mp4", mime: "video/mp4", size: 201 * 1024 * 1024 })).status === 400);
  const ghost = await call("POST", "/tv-media/uploads", root, { name: "ghost.png", mime: "image/png", size: 100 });
  check("put on the TVs without the file having gone up: refused", (await call("POST", "/tv-media", root, { key: ghost.body.data.key, name: "ghost.png", mime: "image/png" })).status === 400);
  check("a key that isn't an upload from the page: refused", (await call("POST", "/tv-media", root, { key: "backups/delta.gz", name: "x", mime: "image/png" })).status === 400);
  const liar = await upload("liar.png", "image/png", 11 * 1024 * 1024, {}, 2000);
  check("said 2 KB but sent 11 MB: refused once it's up, and the file taken out of the bucket", liar.put === 200 && liar.add.status === 400 && inBucket().length === 0, show({ add: liar.add.body, bucket: inBucket() }));

  step("2. Photos and videos on the TVs");
  const p1 = await upload("Team photo.png", "image/png", 5000, { seconds: 12 });
  check("a photo for every TV, 12 seconds", p1.put === 200 && p1.add.status === 200 && p1.add.body.data.allScreens && p1.add.body.data.seconds === 12 && inBucket().length === 1, show(p1.add?.body));
  const v1 = await upload("Promo.mp4", "video/mp4", 40_000, { durationSec: 42.4, allScreens: false, screens: ["draw", "hrms-board"] });
  check("a video for Draw and the HRMS pod board, 42 seconds long", v1.add.status === 200 && v1.add.body.data.kind === "video" && v1.add.body.data.durationSec === 42
    && v1.add.body.data.screens.join() === "draw,hrms-board", show(v1.add?.body));
  const tomorrow = new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10);
  const p2 = await upload("Next week.jpg", "image/jpeg", 3000, { fromDay: tomorrow });
  const p3 = await upload("Old.webp", "image/webp", 3000);
  await call("PATCH", `/tv-media/${p3.add.body.data.id}`, root, { active: false });
  check("one from tomorrow, one switched off", p2.add.status === 200 && p3.add.status === 200);
  check("TVs that don't exist, or none chosen: refused", (await upload("x.png", "image/png", 10, { allScreens: false, screens: ["kitchen"] })).add.status === 400
    && (await upload("y.png", "image/png", 10, { allScreens: false, screens: [] })).add.status === 400);

  let d = await call("GET", "/public/tv/draw", fromCrm);
  const ids = (x: Json) => (x.body.data?.items ?? []).map((i: Json) => i.id).join();
  check("Draw's playlist from another site, no sign-in: the photo then the video — not tomorrow's, not the one switched off",
    d.status === 200 && ids(d) === [p1.add.body.data.id, v1.add.body.data.id].join() && d.body.data.boardSeconds === 60 && d.body.data.enabled, show(d.body));
  check("…open to any site, loadable cross-site", d.headers.get("access-control-allow-origin") === "*" && d.headers.get("cross-origin-resource-policy") === "cross-origin");
  check("…each with its link, timing and length; nothing about who added it", d.body.data.items[0].url.startsWith(`http://127.0.0.1:${process.env.E2E_R2_PORT}/`)
    && d.body.data.items[0].seconds === 12 && d.body.data.items[1].durationSec === 42 && !JSON.stringify(d.body).includes("root@tv-e2e.test"), show(d.body.data.items));
  const again = await call("GET", "/public/tv/draw", fromCrm);
  check("…the same links on the next call (the TV plays them from its cache)", again.body.data.items[0].url === d.body.data.items[0].url);
  const file = await fetch(d.body.data.items[0].url);
  check("…and the link gives the file", file.status === 200 && (await file.arrayBuffer()).byteLength === 5000);
  const s = await call("GET", "/public/tv/sales-crm", fromCrm);
  check("the Sales CRM's playlist: only the photo for every TV", ids(s) === p1.add.body.data.id, ids(s));
  check("a TV that doesn't exist: 404", (await call("GET", "/public/tv/kitchen", fromCrm)).status === 404);

  step("3. Timing, order and changes");
  check("Draw's board up for 90 seconds", (await call("PUT", "/tv-media/screens/draw", root, { boardSeconds: 90 })).status === 200
    && (await call("GET", "/public/tv/draw")).body.data.boardSeconds === 90);
  check("under 10 seconds, or a TV that doesn't exist: refused", (await call("PUT", "/tv-media/screens/draw", root, { boardSeconds: 5 })).status === 400
    && (await call("PUT", "/tv-media/screens/kitchen", root, { boardSeconds: 60 })).status === 404);
  await call("PUT", "/tv-media/screens/remote", root, { enabled: false });
  const off = await call("GET", "/public/tv/remote");
  check("Remote switched off: an empty list (the board only)", off.body.data.enabled === false && off.body.data.items.length === 0);
  await call("PUT", "/tv-media/order", root, { ids: [v1.add.body.data.id, p1.add.body.data.id] });
  check("put in order: the video first on Draw", ids(await call("GET", "/public/tv/draw")) === [v1.add.body.data.id, p1.add.body.data.id].join());
  check("a photo for 2 seconds: refused", (await call("PATCH", `/tv-media/${p1.add.body.data.id}`, root, { seconds: 2 })).status === 400);
  await call("PATCH", `/tv-media/${p1.add.body.data.id}`, root, { seconds: 15, allScreens: false, screens: ["sales-crm", "cs-dubai"] });
  const d2 = await call("GET", "/public/tv/draw");
  check("the photo now 15 s and only on the Sales CRM and CS Dubai: gone from Draw, on CS Dubai", ids(d2) === v1.add.body.data.id
    && (await call("GET", "/public/tv/cs-dubai")).body.data.items[0]?.seconds === 15, show(d2.body.data));
  r = await call("GET", "/tv-media", root);
  const drawScreen = r.body.data.screens.find((x: Json) => x.key === "draw");
  check("the page: the four in order, each TV with what it shows today and how long a round lasts", r.body.data.media.length === 4 && r.body.data.media[0].id === v1.add.body.data.id
    && drawScreen.showing === 1 && drawScreen.breakSeconds === 42 && drawScreen.boardSeconds === 90
    && r.body.data.media.find((m: Json) => m.id === p2.add.body.data.id).showingToday === false, show(drawScreen));

  step("4. The script the TVs load");
  const js = await fetch(`${ROOT}/public/tv/overlay.js?screen=draw`, { headers: fromCrm });
  const text = await js.text();
  check("served as a script any site may load, cached a few minutes", js.status === 200 && /javascript/.test(js.headers.get("content-type") ?? "")
    && js.headers.get("cross-origin-resource-policy") === "cross-origin" && /max-age=300/.test(js.headers.get("cache-control") ?? "") && text.includes("tv:celebrate"));
  const tvPage = await fetch(`${ROOT}/public/sales-tv`, { headers: { origin: "https://crm.example.test" } });
  check("the rest of the API still answers only its own sites", tvPage.status === 403, String(tvPage.status));

  step("5. Removed");
  const before = inBucket().length;
  check("removed: off the TVs and out of the bucket", (await call("DELETE", `/tv-media/${v1.add.body.data.id}`, root)).status === 200
    && ids(await call("GET", "/public/tv/draw")) === "" && inBucket().length === before - 1, show(inBucket()));
  check("removed again: 404", (await call("DELETE", `/tv-media/${v1.add.body.data.id}`, root)).status === 404);

  await mongoose.disconnect();
  console.log(`\n${failures ? "\x1b[31m" : "\x1b[32m"}${checks - failures}/${checks} checks passed\x1b[0m`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
