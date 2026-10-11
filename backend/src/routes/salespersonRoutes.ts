import { Router } from "express";
import { list, detail, leads } from "../controllers/salespersonController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

// Everybody's sales figures across the CRMs: root admins only.
const router = Router();
router.use(authenticate, requireRole("root_admin"));

router.get("/", list);
router.get("/:code/:userId", detail);
router.get("/:code/:userId/leads", leads);

export default router;
