import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  taskTeams, createTask, taskApprovals, decideTask,
} from "../controllers/taskController.js";

const router = Router();

/*
 * Open to anybody signed in, like the mentors calendar.
 *
 * Every real decision is Media ERP's: who may assign into a team, and who may
 * approve. Guarding it again here would be a second opinion that could only
 * ever disagree, and the one further from the data would be the one that was
 * wrong.
 */
router.use(authenticate);

router.get("/teams", taskTeams);
router.post("/", createTask);
router.get("/approvals", taskApprovals);
router.post("/:taskId/decide", decideTask);

export default router;
