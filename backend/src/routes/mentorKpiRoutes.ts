import { Router } from "express";
import {
  deleteDraft, getMentorScores, getPlans, getScores, postApprove, postDraft, postSuggest, putDraft,
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

export default router;
