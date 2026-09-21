import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  taskTeams, createTask, taskDetail, tasksRaised, verifications, verifyTask,
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

/*
 * Before "/:taskId", so a task called "raised" or "verifications" cannot
 * shadow them — the same ordering trap the access routes carry a note about.
 */
router.get("/raised", tasksRaised);
router.get("/verifications", verifications);
router.post("/verifications/:taskId", verifyTask);

router.get("/:taskId", taskDetail);

export default router;
