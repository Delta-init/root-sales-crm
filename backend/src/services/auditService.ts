import type { Request } from "express";
import { AuditLog } from "../models/AuditLog.js";
import type { AuditAction, OrgCode } from "../types/index.js";

const clientIp = (req: Request): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "";
};

/**
 * Auditing must never break the request it is recording, so failures here are
 * logged and swallowed rather than thrown.
 */
export const record = async (
  req: Request,
  action: AuditAction,
  opts: {
    adminId?: string | null;
    adminEmail?: string;
    org?: OrgCode | null;
    detail?: string;
  } = {}
): Promise<void> => {
  try {
    await AuditLog.create({
      admin: opts.adminId ?? null,
      adminEmail: opts.adminEmail ?? "",
      action,
      org: opts.org ?? null,
      ip: clientIp(req),
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
      detail: opts.detail ?? "",
    });
  } catch (error) {
    console.error("Audit write failed:", error);
  }
};
