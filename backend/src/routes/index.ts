import { Router } from "express";
import authRoutes from "./authRoutes.js";
import orgRoutes from "./orgRoutes.js";
import ssoRoutes from "./ssoRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/orgs", orgRoutes);
router.use("/sso", ssoRoutes);

// Phase 3 mounts /reports here.

router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
