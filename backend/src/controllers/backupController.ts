import type { Response, NextFunction } from "express";
import { backupOverview, backupSummary, downloadLink, requestStop, retryFailed, startManualRun } from "../services/backupService.js";
import { record } from "../services/auditService.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/** GET /backups — every portal's backups, the schedule and the recent runs. */
export const overview = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Backups", await backupOverview());
  } catch (error) {
    next(error);
  }
};

/** GET /backups/summary — every portal backed up or not, in one line (the card on Pending). */
export const summary = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Backups summary", await backupSummary());
  } catch (error) {
    next(error);
  }
};

/** POST /backups/run { portals?: string[] } — back up now, in the background. */
export const runNow = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const raw = (req.body ?? {}).portals;
    const portals = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string").slice(0, 20) : undefined;
    const started = await startManualRun(req.admin!.email, portals);
    await record(req, "backup_run", { adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: portals?.length ? portals.join(", ") : "all portals" });
    sendSuccess(res, "Backup started", started, 202);
  } catch (error) {
    next(error);
  }
};

/** POST /backups/stop | /finish | /restart — the running backup: stop now, after this portal, or stop and start again. */
const stopper = (mode: "now" | "after", restart: boolean, action: "backup_stopped" | "backup_finish_requested" | "backup_restarted", said: string) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const out = await requestStop(req.admin!.email, mode, restart);
      await record(req, action, { adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: out.slot });
      sendSuccess(res, said, out, 202);
    } catch (error) {
      next(error);
    }
  };
export const stop = stopper("now", false, "backup_stopped", "Stopping");
export const finish = stopper("after", false, "backup_finish_requested", "Stopping after this portal");
export const restart = stopper("now", true, "backup_restarted", "Restarting");

/** POST /backups/retry — back up again the portals that failed or were stopped in the last backup. */
export const retry = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const out = await retryFailed(req.admin!.email);
    await record(req, "backup_run", { adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: `retry: ${out.portals.join(", ")}` });
    sendSuccess(res, "Retrying", out, 202);
  } catch (error) {
    next(error);
  }
};

/** GET /backups/:id/link — a ten-minute download link for one archive. */
export const link = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const out = await downloadLink(String(req.params.id));
    // Every database's every record, so who took a copy home is recorded.
    await record(req, "backup_downloaded", { adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: `${out.label}: ${out.file}` });
    sendSuccess(res, "Download link", out);
  } catch (error) {
    next(error);
  }
};
