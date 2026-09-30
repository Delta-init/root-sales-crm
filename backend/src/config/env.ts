import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default("5100"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Portal's own database — admins, org registry and the audit log, and the
  // lead-traffic log: each lead from the Meta sheet (name, number, email) and
  // which CRM it was sent to, kept so a lead a CRM could not take waits here.
  // Nothing else of the CRMs' data; their databases stay where they are.
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),

  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  // Deliberately shorter than the CRMs' 7d: this token unlocks all three
  // production systems, so a stolen one should expire the same working day.
  JWT_EXPIRES_IN: z.string().default("8h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  CLIENT_URL: z.string().default("http://localhost:3100"),

  /*
   * Sending mail, for the sign-in codes.
   *
   * All defaulted to empty rather than required, on purpose: an unconfigured
   * mailer must be a feature that politely does not work, never a portal that
   * refuses to boot. Password sign-in carries on regardless, and the code
   * endpoint says it is unavailable rather than pretending to send.
   */
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.string().default("587"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  /** Full From header, e.g. `ERP - DELTA <support@example.com>`. */
  SMTP_EMAIL_FROM: z.string().default(""),

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
  /**
   * HRMS, which is where a person first exists.
   *
   * HR creates the employee there and the portal reads them from it, rather
   * than being a second place the same staff are typed in. Unset, the import
   * is simply unavailable and people can still be added another way.
   *
   * HRMS_ORG_ID is the organization inside HRMS whose staff this portal serves.
   */
  HRMS_API_URL:             z.string().default(""),
  HRMS_CLIENT_ID:           z.string().default(""),
  HRMS_INTEGRATION_SECRET:  z.string().default(""),
  HRMS_ORG_ID:              z.string().default(""),

  /**
   * Lead traffic: the Meta lead sheet posts here, and the portal splits its
   * leads between the Delta and Draw CRMs.
   *
   * LEAD_TRAFFIC_SHEET_KEY is what the sheet's script presents. Unset, the
   * intake refuses everything with a 503 that names it — an empty key must
   * never be one an empty header matches. Posting on into each CRM uses that
   * CRM's own sheet key, read as {CODE}_SHEETS_API_KEY (DELTA_SHEETS_API_KEY,
   * DRAW_SHEETS_API_KEY) in the same way as the rest of a system's settings.
   *
   * The worker retries leads a CRM could not take. "false" stops it, for a
   * second process sharing the same database.
   */
  LEAD_TRAFFIC_SHEET_KEY: z.string().default(""),
  TRAFFIC_WORKER: z.string().default("true"),
  TRAFFIC_WORKER_INTERVAL_MS: z.string().default("30000"),

});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
