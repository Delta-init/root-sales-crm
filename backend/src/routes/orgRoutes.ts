import { Router } from "express";
import { listOrgs } from "../controllers/orgController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/", authenticate, listOrgs);

export default router;
