import { Router } from "express";
import authRoutes from "./authRoutes.js";
import orgRoutes from "./orgRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/orgs", orgRoutes);

// Phase 2 mounts /sso here, Phase 3 mounts /reports.

router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
