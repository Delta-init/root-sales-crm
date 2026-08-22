import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default("5100"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Portal's own database — holds admins, org registry and the audit log only.
  // It never stores CRM data; the three CRM databases stay where they are.
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),

  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  // Deliberately shorter than the CRMs' 7d: this token unlocks all three
  // production systems, so a stolen one should expire the same working day.
  JWT_EXPIRES_IN: z.string().default("8h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  CLIENT_URL: z.string().default("http://localhost:3100"),

  ROOT_ADMIN_NAME: z.string().default("Root Admin"),
  ROOT_ADMIN_EMAIL: z.email().default("root@deltainstitutions.com"),
  ROOT_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe@12345"),

  // ── Org registry (read by seeds/bootstrap.ts) ──────────────────────────
  DELTA_APP_URL: z.string().default(""),
  DELTA_API_URL: z.string().default(""),
  DELTA_MONGODB_URI: z.string().default(""),
  DELTA_SSO_SECRET: z.string().default(""),

  BANGLORE_APP_URL: z.string().default(""),
  BANGLORE_API_URL: z.string().default(""),
  BANGLORE_MONGODB_URI: z.string().default(""),
  BANGLORE_SSO_SECRET: z.string().default(""),

  DRAW_APP_URL: z.string().default(""),
  DRAW_API_URL: z.string().default(""),
  DRAW_MONGODB_URI: z.string().default(""),
  DRAW_SSO_SECRET: z.string().default(""),

  // Group-report base currency. Delta and Draw are already AED, so only
  // Banglore is converted.
  BASE_CURRENCY: z.string().default("AED"),
  INR_TO_AED: z.string().default("0.0435"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
