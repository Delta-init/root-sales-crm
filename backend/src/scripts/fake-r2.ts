/**
 * A stand-in for R2 in backups-check.sh: just enough of S3 for Bun's client —
 * PUT, multipart upload, GET/HEAD, DELETE — kept as files under a directory
 * the check reads. Signatures are not checked. Never pointed at anything real.
 *
 *   bun src/scripts/fake-r2.ts <port> <dir>
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const [port, dir] = [Number(process.argv[2]), process.argv[3]];
const uploads = new Map<string, Map<number, Uint8Array>>();
const pathOf = (p: string) => join(dir, decodeURIComponent(p).replace(/^\/+/, "").replace(/\.\./g, "_"));

const B = (globalThis as unknown as { Bun: { serve(o: unknown): unknown } }).Bun;
B.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req: Request) {
    const u = new URL(req.url);
    const q = u.searchParams;
    const file = pathOf(u.pathname);
    if (req.method === "POST" && q.has("uploads")) {
      const id = crypto.randomUUID();
      uploads.set(id, new Map());
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === "PUT" && q.has("uploadId")) {
      uploads.get(q.get("uploadId")!)?.set(Number(q.get("partNumber")), new Uint8Array(await req.arrayBuffer()));
      return new Response("", { headers: { ETag: `"p${q.get("partNumber")}"` } });
    }
    if (req.method === "POST" && q.has("uploadId")) {
      const parts = uploads.get(q.get("uploadId")!)!;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.concat([...parts.keys()].sort((a, b) => a - b).map((k) => parts.get(k)!)));
      uploads.delete(q.get("uploadId")!);
      // The check reads this to know a big file really went up in parts.
      appendFileSync(join(dir, "_multipart.log"), `${u.pathname} ${parts.size}\n`);
      return new Response(`<CompleteMultipartUploadResult><ETag>"x"</ETag></CompleteMultipartUploadResult>`);
    }
    if (req.method === "PUT") {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, new Uint8Array(await req.arrayBuffer()));
      return new Response("", { headers: { ETag: '"x"' } });
    }
    if (req.method === "GET" || req.method === "HEAD") {
      if (!existsSync(file)) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
      const body = readFileSync(file);
      return new Response(req.method === "HEAD" ? null : body, { headers: { "Content-Length": String(body.length) } });
    }
    if (req.method === "DELETE") {
      if (existsSync(file)) unlinkSync(file);
      return new Response(null, { status: 204 });
    }
    return new Response("not supported", { status: 400 });
  },
});
console.log(`fake R2 on :${port}`);
