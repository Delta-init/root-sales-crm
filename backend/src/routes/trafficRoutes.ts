import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, requireTrafficAccess } from "../middleware/auth.js";
import { requireSheetKey } from "../middleware/sheetKeyAuth.js";
import { ping, intake, getRules, putRules, summary, leads, retry, crmUsers } from "../controllers/trafficController.js";

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

export default router;
