import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, requireRole } from "../middleware/auth.js";
import { requireSheetKey } from "../middleware/sheetKeyAuth.js";
import { ping, intake, getRules, putRules, summary, leads, retry, crmUsers } from "../controllers/trafficController.js";

const router = Router();

/*
 * The lead sheet, with its own key.
 *
 * Rationed, but loosely: the script posts on every change to the sheet and on
 * a timer, a batch at a time, so a handful of requests a minute is normal and
 * a few hundred is somebody else.
 */
const sheetLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests from the lead sheet. Try again in a minute." },
});

router.get("/intake/ping", sheetLimiter, requireSheetKey, ping);
router.post("/intake", sheetLimiter, requireSheetKey, intake);

/*
 * Everything else is root_admin only. The split decides which CRM every lead
 * from the sheet lands in, and the list names and numbers real people.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/rules", getRules);
router.put("/rules", putRules);
router.get("/summary", summary);
router.get("/leads", leads);
router.post("/leads/:id/retry", retry);
router.get("/crm-users/:code", crmUsers);

export default router;
