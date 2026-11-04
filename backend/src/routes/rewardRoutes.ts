import { Router, type NextFunction, type Response } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";
import {
  createGift, removeGift, rewardsOverview, saveSettings, setGiftPhoto, updateClaim, updateGift,
} from "../services/rewardsService.js";

/*
 * The Rewards page (2026-11-04): the sales CRMs' gift targets, the gifts on their shelf, and every gift chosen, for
 * the office to buy and hand over. Root admins only, like the TV pages. The CRMs read theirs from the service routes;
 * the photos are open at /public/rewards/photos.
 */
const router = Router();
router.use(authenticate, requireRole("root_admin"));

const by = (req: AuthenticatedRequest) => req.admin?.email ?? "";
const handle = (fn: (req: AuthenticatedRequest) => Promise<[string, unknown]>) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const [message, data] = await fn(req);
      sendSuccess(res, message, data);
    } catch (error) {
      next(error);
    }
  };

router.get("/", handle(async (req) => ["Gift rewards", await rewardsOverview(typeof req.query.month === "string" ? req.query.month : undefined)]));
router.put("/settings", handle(async (req) => ["Targets saved", await saveSettings(req.body ?? {}, by(req))]));
router.post("/gifts", handle(async (req) => ["Gift added", await createGift(req.body ?? {})]));
router.patch("/gifts/:id", handle(async (req) => ["Gift saved", await updateGift(req.params.id!, req.body ?? {})]));
router.put("/gifts/:id/photo", handle(async (req) => ["Photo saved", await setGiftPhoto(req.params.id!, req.body ?? {})]));
router.delete("/gifts/:id", handle(async (req) => {
  const r = await removeGift(req.params.id!);
  return [r.removed ? "Gift removed" : "Taken off the shelf: somebody has chosen it, so it stays on their request", r];
}));
router.patch("/claims/:id", handle(async (req) => ["Saved", await updateClaim(req.params.id!, req.body ?? {}, by(req))]));

export default router;
