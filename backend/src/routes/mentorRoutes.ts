import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { mentorSchedule } from "../controllers/mentorController.js";

const router = Router();

/*
 * Root admins only, for now.
 *
 * This is a staff timetable — who works when, and how full their week is. It
 * is not secret, but it is nobody's business by default, and widening later
 * is a decision somebody can make on purpose. Narrowing it after everybody
 * has been reading it is not.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/schedule", mentorSchedule);

export default router;
