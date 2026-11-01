import { Router } from "express";
import { getMine, saveMine } from "../controllers/serviceTrackerController.js";
import { crmLeads } from "../controllers/crmLeadsController.js";
import { crmCommissionForFinance } from "../controllers/crmCommissionController.js";
import * as engine from "../controllers/commissionEngineController.js";
import { authenticateOrgService, authenticatePortalService } from "../middleware/orgServiceAuth.js";

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

export default router;
