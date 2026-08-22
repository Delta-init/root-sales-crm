import { Router } from "express";
import { overview, timeline, sources } from "../controllers/reportController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// Any authenticated admin may read the group report, including a viewer.
// Reading aggregate numbers is not the same privilege as being dropped into a
// production CRM, which is why only /sso/launch adds requireRole.
router.use(authenticate);

router.get("/overview", overview);
router.get("/timeline", timeline);
router.get("/sources", sources);

export default router;
