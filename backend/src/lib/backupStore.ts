import { env } from "../config/env.js";

/**
 * Where the backups are kept: the delta-backups bucket in Cloudflare R2.
 *
 * Bun's own S3 client rather than the AWS SDK — no dependency to install on
 * the server, and it uploads a large file in parts by itself (the LMS archive
 * is tens of megabytes). Bun has had it since 1.2; an older Bun says so on the
 * Backups page instead of failing at two in the morning.
 */

interface S3File {
  write(data: unknown, opts?: { type?: string }): Promise<number>;
}
interface S3Client {
  file(key: string): S3File;
  write(key: string, data: unknown, opts?: { type?: string }): Promise<number>;
  presign(key: string, opts?: { expiresIn?: number; method?: string }): string;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
type S3ClientCtor = new (opts: { accessKeyId: string; secretAccessKey: string; bucket: string; endpoint: string }) => S3Client;

const Ctor = (globalThis as unknown as { Bun?: { S3Client?: S3ClientCtor } }).Bun?.S3Client;

/** What is missing before backups can be stored, named; empty when they can. */
export function storeMissing(): string[] {
  const missing: string[] = [];
  if (!Ctor) missing.push("Bun 1.2 or newer on the server (this one has no S3 client)");
  if (!env.BACKUP_R2_ENDPOINT && !env.BACKUP_R2_ACCOUNT_ID) missing.push("BACKUP_R2_ACCOUNT_ID");
  if (!env.BACKUP_R2_ACCESS_KEY_ID) missing.push("BACKUP_R2_ACCESS_KEY_ID");
  if (!env.BACKUP_R2_SECRET_ACCESS_KEY) missing.push("BACKUP_R2_SECRET_ACCESS_KEY");
  if (!env.BACKUP_R2_BUCKET) missing.push("BACKUP_R2_BUCKET");
  return missing;
}

let client: S3Client | null = null;
const get = (): S3Client => {
  if (client) return client;
  if (!Ctor || storeMissing().length) throw new Error(`Backups are not set up: ${storeMissing().join(", ")}`);
  client = new Ctor({
    accessKeyId: env.BACKUP_R2_ACCESS_KEY_ID,
    secretAccessKey: env.BACKUP_R2_SECRET_ACCESS_KEY,
    bucket: env.BACKUP_R2_BUCKET,
    endpoint: env.BACKUP_R2_ENDPOINT || `https://${env.BACKUP_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  });
  return client;
};

export const backupStore = {
  bucket: () => env.BACKUP_R2_BUCKET,
  /** A file on this server's disk, uploaded under `key`. */
  async upload(key: string, path: string): Promise<void> {
    const file = (globalThis as unknown as { Bun: { file(p: string): unknown } }).Bun.file(path);
    await get().write(key, file, { type: "application/gzip" });
  },
  async exists(key: string): Promise<boolean> {
    return get().exists(key);
  },
  /** A link the browser downloads the archive from, good for ten minutes. */
  link(key: string): string {
    return get().presign(key, { expiresIn: 600, method: "GET" });
  },
  async remove(key: string): Promise<void> {
    await get().delete(key);
  },
};
