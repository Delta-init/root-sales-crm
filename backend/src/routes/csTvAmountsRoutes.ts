import { Router, type NextFunction, type Response } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { addCsTvAmount, addCsTvPerson, csTvAmounts, removeCsTvAmount, removeCsTvPerson, updateCsTvAmount } from "../services/csTvAmountsService.js";

/*
 * The CS TV amounts page (2026-11-14): amounts typed for a Bangalore CS that CS Portal's CS TV shows like payments —
 * root admins only, like the other TV pages. CS Portal keeps them (services/csTvAmountsService.ts).
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

router.get("/", handle(async (req) => ["CS TV amounts", await csTvAmounts(req.query.month)]));
// Somebody added by name (2026-11-14): no CS account in CS Portal, picked like the team's CSs.
router.post("/people", handle(async (req) => ["Added", await addCsTvPerson(req.body ?? {}, by(req))]));
router.delete("/people/:id", handle(async (req) => ["Removed", await removeCsTvPerson(req.params.id!)]));
router.post("/", handle(async (req) => ["On the TV", await addCsTvAmount(req.body ?? {}, by(req))]));
router.patch("/:id", handle(async (req) => ["Saved", await updateCsTvAmount(req.params.id!, req.body ?? {}, by(req))]));
router.delete("/:id", handle(async (req) => ["Removed from the TV", await removeCsTvAmount(req.params.id!)]));

export default router;
