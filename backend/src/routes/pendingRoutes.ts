import { Router } from "express";
import { cs, enrolments, finance, overview, sales, salesList } from "../controllers/pendingController.js";
import { byPerson } from "../controllers/callsController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Root admins only, like the group report: it is every portal's queue, and who
 * each item waits on, in one place. Guarded here as well as hidden in the menu.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/", overview);
// Each person's 3CX calls and talk time in a period, beside what waits on them (2026-10-14).
router.get("/calls", byPerson);
// Every sales CRM's enrolment workflow — where each unfinished close stands and whom it waits on (2026-10-14).
router.get("/enrolments", enrolments);
// What waits on each Tetra Commission CS, and which students — the CS portal tab (2026-10-17).
router.get("/cs", cs);
// A tab per sales CRM: inactive leads, overdue reminders, not connected, lost and calls (2026-10-17).
router.get("/sales", salesList);
router.get("/sales/:code", sales);
// Finance: approvals waiting and delayed, entries typed with an old date (2026-10-17).
router.get("/finance", finance);

export default router;
