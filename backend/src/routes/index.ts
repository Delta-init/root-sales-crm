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
import taskRoutes from "./taskRoutes.js";
import trafficRoutes from "./trafficRoutes.js";
import portalReportRoutes from "./portalReportRoutes.js";
import pendingRoutes from "./pendingRoutes.js";
import salespersonRoutes from "./salespersonRoutes.js";
import callRoutes from "./callRoutes.js";
import cseRoutes from "./cseRoutes.js";
import commissionPlanRoutes from "./commissionPlanRoutes.js";
import backupRoutes from "./backupRoutes.js";
import salesTvRoutes from "./salesTvRoutes.js";
import managerTvRoutes from "./managerTvRoutes.js";
import publicRoutes from "./publicRoutes.js";
import tvMediaRoutes from "./tvMediaRoutes.js";
import csTvAmountsRoutes from "./csTvAmountsRoutes.js";
import classTvRoutes from "./classTvRoutes.js";
import walletRoutes from "./walletRoutes.js";
import rewardRoutes from "./rewardRoutes.js";
import mentorKpiRoutes from "./mentorKpiRoutes.js";

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
router.use("/tasks", taskRoutes);
router.use("/traffic", trafficRoutes);
router.use("/pending", pendingRoutes);
// Reports, a tab per portal — what got done in a period (2026-10-17).
router.use("/portal-reports", portalReportRoutes);
router.use("/salespeople", salespersonRoutes);
// Every portal's 3CX calls and recordings (2026-10-14).
router.use("/calls", callRoutes);
router.use("/cses", cseRoutes);
router.use("/commission-plans", commissionPlanRoutes);
// Every portal's database, into R2 twice a day (2026-10-16).
router.use("/backups", backupRoutes);
// Sales TV: Dubai Sales, Draw and Remote on one screen (2026-10-20) — root admins here,
// and the open copy for the office TVs under /public (no sign-in, no emails).
router.use("/sales-tv", salesTvRoutes);
router.use("/manager-tv", managerTvRoutes);
router.use("/public", publicRoutes);
// The office TVs' photos and videos (2026-11-02) — root admins; the TVs read theirs from /public/tv (index.ts).
router.use("/tv-media", tvMediaRoutes);
// Amounts typed for a Bangalore CS that CS Portal's CS TV shows like payments (2026-11-14) — root admins; kept in CS Portal.
router.use("/cs-tv-amounts", csTvAmountsRoutes);
// The Class TV's recorded lines (2026-11-14) — root admins; the TVs read the board and the recordings from /public.
router.use("/class-tv", classTvRoutes);
// My Wallet, from the HRMS (2026-11-04) — everyone signed in, their own only.
router.use("/wallet", walletRoutes);
// The sales CRMs' gift rewards: targets, gifts and the gifts chosen (2026-11-04) — root admins.
router.use("/rewards", rewardRoutes);
// Mentor KPIs: the plan (weights, targets) kept and approved here, and every mentor's points worked out here (2026-11-09).
router.use("/mentor-kpis", mentorKpiRoutes);

router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
