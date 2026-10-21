import { Router } from "express";
import { getMine, saveMine } from "../controllers/serviceTrackerController.js";
import { crmLeads } from "../controllers/crmLeadsController.js";
import { crmCommissionForFinance } from "../controllers/crmCommissionController.js";
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

// Server-to-server only: a CRM backend acting for its own signed-in user.
// Never reachable from a browser — the secret lives in the CRM's environment.
router.use(authenticateOrgService);

router.get("/tracker/me", getMine);
router.put("/tracker/me", saveMine);

export default router;
