import { Router } from "express";
import { overview, timeline, sources } from "../controllers/reportController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Root admins only.
 *
 * This read was open to every admin, on the reasoning that aggregate numbers
 * are not the same privilege as being dropped into a production CRM. That
 * holds for what a launch *does* and not for what this *says*: the overview is
 * every CRM's revenue, conversion and pipeline in one place, which is a
 * sharper picture of how the business is doing than most of the people with a
 * portal account have any reason to hold.
 *
 * Guarded here and not only in the navigation. A hidden link is a decision
 * about tidiness; this is the decision about access, and an endpoint that
 * answers anyone who types its address is open however the menu looks.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/overview", overview);
router.get("/timeline", timeline);
router.get("/sources", sources);

export default router;
