import { Router } from "express";
import { list, detail } from "../controllers/cseController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

// CS Portal's CSEs and their figures: root admins only.
const router = Router();
router.use(authenticate, requireRole("root_admin"));

router.get("/", list);
router.get("/:userId", detail);

export default router;
