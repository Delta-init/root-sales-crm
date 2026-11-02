import { Router, type NextFunction, type Response } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { addMedia, removeMedia, reorderMedia, saveScreen, startUpload, tvMediaOverview, updateMedia } from "../services/tvMediaService.js";

/*
 * The TV media page (2026-11-02): the office TVs' photos and videos and each TV's timing — root admins only, like the
 * Sales TV. The TVs themselves read their lists from the open routes in tvPublicRoutes.ts.
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

router.get("/", handle(async () => ["TV media", await tvMediaOverview()]));
router.post("/uploads", handle(async (req) => ["Upload link", await startUpload(req.body ?? {})]));
router.post("/", handle(async (req) => ["On the TVs", await addMedia(req.body ?? {}, by(req))]));
router.put("/order", handle(async (req) => ["Order saved", await reorderMedia(req.body?.ids)]));
router.put("/screens/:key", handle(async (req) => ["TV saved", await saveScreen(req.params.key!, req.body ?? {}, by(req))]));
router.patch("/:id", handle(async (req) => ["Saved", await updateMedia(req.params.id!, req.body ?? {})]));
router.delete("/:id", handle(async (req) => ["Removed", await removeMedia(req.params.id!)]));

export default router;
