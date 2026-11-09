import { Router } from "express";
import {
  deleteDraft, getCorrections, getMentorScores, getPlans, getScores, getSettings, getSnapshots, postApprove, postApproveCorrection,
  postCorrection, postDraft, postFreeze, postRejectCorrection, postSuggest, putDraft, putSettings,
} from "../controllers/mentorKpiController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Mentor KPIs (the user, 2026-11-09): the plan — categories, subcategories, KPIs, weights and targets — is edited only
 * here, and Root works out every mentor's points with it. Root admins only, approving included; for now a preview
 * nobody else sees.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/plans", getPlans);
router.post("/plans/draft", postDraft);
router.put("/plans/draft", putDraft);
router.delete("/plans/draft", deleteDraft);
// Each role's targets suggested from the last three months (into the draft — nothing approved by it).
router.post("/plans/draft/suggest-targets", postSuggest);
router.post("/plans/draft/approve", postApprove);
router.get("/scores", getScores);
router.get("/scores/mentor", getMentorScores);
// A finished month frozen (automatically on the 1st, or by hand), its versions, and the corrections that make new ones.
router.get("/snapshots", getSnapshots);
router.post("/snapshots/freeze", postFreeze);
router.get("/corrections", getCorrections);
router.post("/corrections", postCorrection);
router.post("/corrections/:id/approve", postApproveCorrection);
router.post("/corrections/:id/reject", postRejectCorrection);
// Open to the CS Portal or not — opening starts the 60-day observation period.
router.get("/settings", getSettings);
router.put("/settings", putSettings);

export default router;
