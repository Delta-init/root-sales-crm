import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

/**
 * The portal's one and only reason to send mail: sign-in codes.
 *
 * Built lazily and kept, because a transport opened per message would pay a
 * TLS handshake for every sign-in, and a code is worth nothing if it arrives
 * late.
 *
 * Nothing here throws on a missing configuration. A portal that would not
 * start because an SMTP host was absent would be a worse outcome than one
 * where a sign-in method is unavailable — password sign-in is untouched, and
 * `isConfigured` lets the endpoint say so plainly rather than accepting an
 * address and quietly sending nothing.
 */

let transport: Transporter | null = null;

export const isConfigured = (): boolean =>
  Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

const get = (): Transporter => {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    // 465 is implicit TLS; 587 starts plain and upgrades with STARTTLS, which
    // nodemailer does on its own. Saying `secure: true` on 587 hangs.
    secure: Number(env.SMTP_PORT) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transport;
};

/** Falls back to the authenticating user when no From header is configured. */
const from = (): string => env.SMTP_EMAIL_FROM || env.SMTP_USER;

export const mailer = {
  isConfigured,

  /**
   * Send somebody the code that signs them in.
   *
   * The code is in the subject as well as the body: most people read it off a
   * notification without opening anything, and one that makes them open the
   * message to find six digits is a worse version of the same thing.
   */
  async sendLoginCode(to: string, code: string, minutes: number): Promise<void> {
    await get().sendMail({
      from: from(),
      to,
      subject: `${code} is your Root portal sign-in code`,
      text: [
        `Your sign-in code is ${code}.`,
        ``,
        `It works once and expires in ${minutes} minutes.`,
        ``,
        `If you did not ask to sign in, you can ignore this message — somebody`,
        `typed your address and nothing has happened to your account.`,
      ].join("\n"),
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#111">
          <p>Your sign-in code is</p>
          <p style="font-size:30px;font-weight:700;letter-spacing:.18em;margin:16px 0">${code}</p>
          <p style="color:#555">It works once and expires in ${minutes} minutes.</p>
          <p style="color:#777;font-size:13px;margin-top:24px">
            If you did not ask to sign in, you can ignore this message — somebody
            typed your address and nothing has happened to your account.
          </p>
        </div>
      `,
    });
  },
};
