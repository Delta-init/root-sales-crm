import { env } from "../config/env.js";

/**
 * Where the office TVs' photos and videos are kept (2026-11-02): the backups' R2 bucket under tv/, with the backups'
 * account and keys, unless TV_MEDIA_R2_* say otherwise — through Bun's S3 client like the backups (lib/backupStore.ts).
 * The TV media page uploads straight into it with a signed link, so a 200 MB video never passes through this server;
 * the TVs play from it with a signed link too.
 */

interface S3Stat { size: number }
interface S3File { stat(): Promise<S3Stat> }
interface S3Client {
  file(key: string): S3File;
  presign(key: string, opts?: { expiresIn?: number; method?: string; type?: string }): string;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
type S3ClientCtor = new (opts: { accessKeyId: string; secretAccessKey: string; bucket: string; endpoint: string }) => S3Client;

const Ctor = (globalThis as unknown as { Bun?: { S3Client?: S3ClientCtor } }).Bun?.S3Client;

const account = () => env.TV_MEDIA_R2_ACCOUNT_ID || env.BACKUP_R2_ACCOUNT_ID;
const keyId = () => env.TV_MEDIA_R2_ACCESS_KEY_ID || env.BACKUP_R2_ACCESS_KEY_ID;
const secret = () => env.TV_MEDIA_R2_SECRET_ACCESS_KEY || env.BACKUP_R2_SECRET_ACCESS_KEY;
const bucket = () => env.TV_MEDIA_R2_BUCKET || env.BACKUP_R2_BUCKET;
const endpoint = () => env.TV_MEDIA_R2_ENDPOINT || env.BACKUP_R2_ENDPOINT;

/** What is missing before photos and videos can be stored, named; empty when they can. */
export function tvStoreMissing(): string[] {
  const missing: string[] = [];
  if (!Ctor) missing.push("Bun 1.2 or newer on the server (this one has no S3 client)");
  if (!endpoint() && !account()) missing.push("BACKUP_R2_ACCOUNT_ID");
  if (!keyId()) missing.push("BACKUP_R2_ACCESS_KEY_ID");
  if (!secret()) missing.push("BACKUP_R2_SECRET_ACCESS_KEY");
  if (!bucket()) missing.push("BACKUP_R2_BUCKET");
  return missing;
}

let client: S3Client | null = null;
const get = (): S3Client => {
  if (client) return client;
  if (!Ctor || tvStoreMissing().length) throw Object.assign(new Error(`TV photos and videos are not set up on this server: ${tvStoreMissing().join(", ")}`), { statusCode: 503 });
  client = new Ctor({
    accessKeyId: keyId(),
    secretAccessKey: secret(),
    bucket: bucket(),
    endpoint: endpoint() || `https://${account()}.r2.cloudflarestorage.com`,
  });
  return client;
};

/**
 * A viewing link lasts a day and is handed out unchanged until it has under six hours left — so a TV showing the same
 * video every minute plays it from its own cache rather than fetching it again under a new link each time.
 */
const VIEW_SECONDS = 24 * 3600;
const RENEW_UNDER_MS = 6 * 3600_000;
const views = new Map<string, { url: string; until: number }>();

export const tvMediaStore = {
  /** A link the browser PUTs the file to, good for 30 minutes. */
  uploadLink(key: string, type: string): string {
    return get().presign(key, { expiresIn: 1800, method: "PUT", type });
  },
  viewLink(key: string): string {
    const held = views.get(key);
    if (held && held.until - Date.now() > RENEW_UNDER_MS) return held.url;
    const url = get().presign(key, { expiresIn: VIEW_SECONDS, method: "GET" });
    views.set(key, { url, until: Date.now() + VIEW_SECONDS * 1000 });
    return url;
  },
  /** The stored file's size, or null when nothing was uploaded under `key`. */
  async size(key: string): Promise<number | null> {
    if (!(await get().exists(key))) return null;
    return (await get().file(key).stat()).size;
  },
  async remove(key: string): Promise<void> {
    views.delete(key);
    await get().delete(key);
  },
};
