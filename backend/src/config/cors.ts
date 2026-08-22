import type { CorsOptions } from "cors";
import { env } from "./env.js";

/** Origins are compared without a trailing slash — `https://x.com/` and
 *  `https://x.com` are the same origin, but a string compare says otherwise,
 *  which is the usual cause of a CORS failure that "should" be configured. */
const normalise = (url: string) => url.trim().replace(/\/+$/, "");

const DEV_ORIGINS = [
  "http://localhost:3100",
  "http://localhost:3000",
  "http://localhost:3001",
];

// CLIENT_URL accepts a comma-separated list so one deployment can serve both
// the apex domain and a staging host without a code change.
export const allowedOrigins = Array.from(
  new Set([...env.CLIENT_URL.split(","), ...DEV_ORIGINS].map(normalise).filter(Boolean))
);

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // No Origin header: curl, health checks, server-to-server. Not a browser
    // cross-origin request, so there is nothing to protect against here.
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(normalise(origin))) return callback(null, true);

    // Log the rejection with the exact value received. Browsers report only a
    // generic CORS failure, so without this line the server side is silent and
    // a stray slash or an http/https mismatch is invisible.
    console.warn(
      `CORS: rejected origin ${origin}\n` +
        `     allowed: ${allowedOrigins.join(", ")}\n` +
        `     fix: add it to CLIENT_URL (comma-separated) and restart`
    );
    // 403, not the errorHandler's default 500 — a blocked origin is a client
    // configuration problem, and a 500 sends people hunting for a server bug.
    return callback(
      Object.assign(new Error(`Origin ${origin} is not allowed by CORS`), {
        statusCode: 403,
      })
    );
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
