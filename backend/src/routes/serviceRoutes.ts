import { Router } from "express";
import { getMine, saveMine } from "../controllers/serviceTrackerController.js";
import { crmLeads } from "../controllers/crmLeadsController.js";
import { crmCommissionForFinance } from "../controllers/crmCommissionController.js";
import * as engine from "../controllers/commissionEngineController.js";
import { servicePortalCorrection, servicePortalMentor, servicePortalScores } from "../controllers/mentorKpiController.js";
import { dgoAchieverMetrics } from "../controllers/dgoAchieverController.js";
import { authenticateAnyPortal, authenticateOrgService, authenticatePortalService } from "../middleware/orgServiceAuth.js";
import { serviceClaim, serviceRewards } from "../services/rewardsService.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { listMoves, moveLeads, moveTargets, undoMove } from "../services/crmLeadMoveService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import type { NextFunction, Response } from "express";

const router = Router();

// The LMS asking which sales CRMs its students are leads in. Its own door,
// registered before the CRMs' one below: the LMS proves itself with the
// secret Root already shares with it (LMS_SSO_SECRET), not a CRM's.
router.post("/crm-leads", authenticatePortalService("lms"), crmLeads);

// Finance asking each sales CRM's counted commission for a month — its CRM commission tab, where a manager approves
// and accounts pay (2026-10-21). Finance proves itself with the secret Root shares with it (FINANCE_HQ_SSO_SECRET,
// its ROOT_ERP_SECRET).
router.get("/crm-commission", authenticatePortalService("finance-hq"), crmCommissionForFinance);

// Finance asking each salesperson's salary on the CRM slabs for a month — its payroll puts them on it, loss of pay
// priced off it (2026-11-01). The same secret as the commission above.
router.get("/finance/slab-pay", authenticatePortalService("finance-hq"), engine.slabPay);
// Mentor KPIs for CS Portal's and the LMS admin's My KPIs (2026-11-09): read only, plus asking for a correction. The
// portal decides who may see whom; Root answers only once a root admin has opened it (409 until then).
const kpiPortals = authenticateAnyPortal(["commission", "lms"]);
router.get("/mentor-kpis/scores", kpiPortals, servicePortalScores);
router.get("/mentor-kpis/mentor", kpiPortals, servicePortalMentor);
router.post("/mentor-kpis/corrections", kpiPortals, servicePortalCorrection);

// DGO Points' monthly achievers in HRMS (2026-11-21): each person's month — Dubai sales and team totals as gift rewards
// count them, who took a gift, CS course payments, mentor KPI scores. HRMS proves itself with the secret Root shares
// with it (HRMS_SSO_SECRET, its ROOT_ERP_SECRET). Read-only.
router.get("/dgo/achiever-metrics", authenticatePortalService("hrms"), dgoAchieverMetrics);

// Server-to-server only: a CRM backend acting for its own signed-in user.
// Never reachable from a browser — the secret lives in the CRM's environment.
router.use(authenticateOrgService);

router.get("/tracker/me", getMine);
router.put("/tracker/me", saveMine);

// A sales CRM's commission worked out by Root from the plan kept here (2026-11-01): its plan, who earns what on a
// sale, its My Pay. Only its own — the CRM is the one whose secret matched.
router.get("/commission/plan", engine.plan);
router.post("/commission/resolve", engine.resolve);
router.get("/commission/pay", engine.pay);

// A sales CRM's gift rewards (2026-11-04): the targets, the gifts on the shelf and this person's gift this month;
// and a gift chosen there. The CRM counts what its people closed; Root holds it to the targets kept here.
router.get("/rewards", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    sendSuccess(res, "Gift rewards", await serviceRewards(req.serviceOrg!.code, userId));
  } catch (error) {
    next(error);
  }
});
router.post("/rewards/claims", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Gift chosen", await serviceClaim(req.serviceOrg!.code, req.body ?? {}), 201);
  } catch (error) {
    next(error);
  }
});

// Moving leads between the sales CRMs (2026-11-19): the CRM a lead leaves asks; Root hands it to the other CRM. Which
// CRM is asking is the secret that matched.
const moving = (message: string, fn: (req: AuthenticatedRequest) => Promise<unknown>, created = false) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, message, await fn(req), created ? 201 : 200);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status) return sendError(res, (error as Error).message, status);
      next(error);
    }
  };
router.get("/lead-moves/targets", moving("Where leads can go", (req) => moveTargets(req.serviceOrg!.code)));
router.get("/lead-moves", moving("Moves", (req) => listMoves({ crm: req.serviceOrg!.code, limit: Number(req.query.limit) || 100 })));
router.post("/lead-moves", moving("Leads moved", (req) => moveLeads(req.serviceOrg!.code, req.body ?? {}), true));
router.post("/lead-moves/:id/undo", moving("Move undone", (req) =>
  undoMove(req.serviceOrg!.code, req.params.id!, String((req.body ?? {}).byName ?? ""))));

export default router;
