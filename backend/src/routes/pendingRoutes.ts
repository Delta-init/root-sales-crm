import { Router } from "express";
import { cs, enrolments, finance, hrms, media, overview, sales, salesList } from "../controllers/pendingController.js";
import { byPerson } from "../controllers/callsController.js";
import { authenticate, requireAnySalesPending, requirePendingTab, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Root admins see every tab: it is every portal's queue, and who each item waits on, in one place. Since 2026-10-24 a
 * tab can also be given to somebody (Users → their page → Pending access): the CS portal to the CS lead, one sales CRM
 * to its Sales Manager. "All portals" and the calls by person stay with root admins. Guarded here as well as hidden in
 * the menu.
 */
router.use(authenticate);

router.get("/", requireRole("root_admin"), overview);
// Each person's 3CX calls and talk time in a period, beside what waits on them (2026-10-14).
router.get("/calls", requireRole("root_admin"), byPerson);
// Every sales CRM's enrolment workflow — where each unfinished close stands and whom it waits on (2026-10-14).
router.get("/enrolments", requirePendingTab("enrolments"), enrolments);
// What waits on each Tetra Commission CS, and which students — the CS portal tab (2026-10-17).
router.get("/cs", requirePendingTab("cs"), cs);
// A tab per sales CRM: inactive leads, overdue reminders, not connected, lost and calls (2026-10-17) — the list cut to
// the CRMs somebody was given.
router.get("/sales", requireAnySalesPending, salesList);
router.get("/sales/:code", requirePendingTab((req) => `sales:${String(req.params.code)}`), sales);
// Finance: approvals waiting and delayed, entries typed with an old date (2026-10-17).
router.get("/finance", requirePendingTab("finance"), finance);
// HRMS (leave, regularization, hiring, office keeping, procurement, on leave today) and Media ERP (media, tasks, leader desk).
router.get("/hrms", requirePendingTab("hrms"), hrms);
router.get("/media", requirePendingTab("media"), media);

export default router;
