import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, requireTrafficAccess } from "../middleware/auth.js";
import { requireSheetKey } from "../middleware/sheetKeyAuth.js";
import type { NextFunction, Response } from "express";
import { findLeads, moveFromRoot, moveTargets, movesView, undoFromRoot } from "../services/crmLeadMoveService.js";
import { record } from "../services/auditService.js";
import { sendError, sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { ping, intake, statuses, getRules, putRules, summary, leads, retry, crmUsers } from "../controllers/trafficController.js";

const router = Router();

/*
 * The lead sheets, with their own key; each says which sheet it is.
 *
 * Rationed, but loosely: a script posts on every change to its sheet and on
 * a timer, a batch at a time, so a handful of requests a minute is normal and
 * a few hundred is somebody else.
 */
const sheetLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests from the lead sheets. Try again in a minute." },
});

router.get("/intake/ping", sheetLimiter, requireSheetKey, ping);
router.post("/intake", sheetLimiter, requireSheetKey, intake);
// Each row's status in its CRM, for the sheet's "CRM Status" column (2026-11-16). Read-only.
router.post("/statuses", sheetLimiter, requireSheetKey, statuses);

/*
 * Everything else: root admins, and whoever a root admin has given lead-traffic
 * access. Looking needs `view`. Changing the split, sending a lead by hand, and
 * listing a CRM's people to hand leads to all need `manage` — the split decides
 * which CRM every lead from the sheet lands in.
 */
router.use(authenticate);

router.get("/rules", requireTrafficAccess("view"), getRules);
router.get("/summary", requireTrafficAccess("view"), summary);
router.get("/leads", requireTrafficAccess("view"), leads);
router.put("/rules/:sheet", requireTrafficAccess("manage"), putRules);
router.post("/leads/:id/retry", requireTrafficAccess("manage"), retry);
router.get("/crm-users/:code", requireTrafficAccess("manage"), crmUsers);

/*
 * Lead moves between the sales CRMs (2026-11-19): every move (view), finding a lead in any CRM by phone or name
 * (view), and — manage — moving one out of the CRM it is in and undoing a move (24 hours). Moves and undos are audited.
 */
const moves = (message: string, fn: (req: AuthenticatedRequest) => Promise<unknown>) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, message, await fn(req));
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status) return sendError(res, (error as Error).message, status);
      next(error);
    }
  };
const adminName = (req: AuthenticatedRequest) => String(req.admin?.email ?? "Root admin").split("@")[0];
router.get("/crm-moves", requireTrafficAccess("view"), moves("Moves", () => movesView()));
router.get("/crm-moves/find", requireTrafficAccess("view"), moves("Leads found", (req) => findLeads(String(req.query.q ?? ""))));
router.get("/crm-moves/targets/:from", requireTrafficAccess("manage"), moves("Where leads can go", (req) => moveTargets(String(req.params.from))));
router.post("/crm-moves", requireTrafficAccess("manage"), moves("Leads moved", async (req) => {
  const result = await moveFromRoot(req.body ?? {}, adminName(req));
  const b = req.body ?? {};
  await record(req, "crm_leads_moved", {
    adminId: req.admin!.adminId, adminEmail: req.admin!.email,
    detail: `${result.moved.length} moved ${b.from} → ${b.to} (${b.mode}${b.teamId ? `, team ${b.teamId}` : ""}${b.userId ? `, person ${b.userId}` : ""})${result.refused.length ? `; ${result.refused.length} not moved` : ""}: ${result.moved.map((m) => m.name).join(", ").slice(0, 400)}`,
  });
  return result;
}));
router.post("/crm-moves/:id/undo", requireTrafficAccess("manage"), moves("Move undone", async (req) => {
  const row = await undoFromRoot(String(req.params.id), adminName(req));
  await record(req, "crm_lead_move_undone", { adminId: req.admin!.adminId, adminEmail: req.admin!.email, detail: `${row?.name ?? ""} back in ${row?.from} from ${row?.to}` });
  return row;
}));

export default router;
