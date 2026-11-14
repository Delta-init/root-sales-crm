import { Router, type NextFunction, type Response } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { classTv, mentorVoices, removeVoice, saveVoice } from "../services/classTvService.js";

/*
 * The Mentor voices page (2026-11-14): the lines the Class TV plays, recorded here — root admins only, like the other
 * TV pages. The TVs themselves read the board and the recordings from the open routes in publicRoutes.ts.
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

// The board as a root admin sees it: the LMS's own words when it can't be reached.
router.get("/", handle(async (req) => ["Class TV", await classTv(req.query.academy)]));
router.get("/voices", handle(async () => ["Mentor voices", await mentorVoices()]));
router.put("/voices/:key", handle(async (req) => ["Recorded", await saveVoice(req.params.key!, req.body ?? {}, by(req))]));
router.delete("/voices/:key", handle(async (req) => ["Removed", await removeVoice(req.params.key!)]));

export default router;
