import { Router } from "express";
import authRoutes from "./authRoutes.js";
import orgRoutes from "./orgRoutes.js";
import accessRoutes from "./accessRoutes.js";
import ssoRoutes from "./ssoRoutes.js";
import reportRoutes from "./reportRoutes.js";
import trackerRoutes from "./trackerRoutes.js";
import repRoutes from "./repRoutes.js";
import serviceRoutes from "./serviceRoutes.js";
import mentorRoutes from "./mentorRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/orgs", orgRoutes);
router.use("/sso", ssoRoutes);
router.use("/access", accessRoutes);
router.use("/reports", reportRoutes);
router.use("/tracker", trackerRoutes);
router.use("/rep", repRoutes);
router.use("/service", serviceRoutes);
router.use("/mentors", mentorRoutes);

router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
