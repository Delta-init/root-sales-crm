import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { mentorSchedule, scheduleMeeting } from "../controllers/mentorController.js";

const router = Router();

/*
 * Open to anybody signed in to the portal.
 *
 * It began as root admins only, on the reasoning that a staff timetable is
 * nobody's business by default. Booking changed that: the people who need an
 * hour with a mentor are the people doing the work, and a calendar only they
 * cannot see is one they have to ask somebody else to read for them.
 *
 * Nothing here reaches into another system on the viewer's behalf — it lists
 * one academy's mentors and books time with them, both of which the LMS
 * authorises for itself.
 */
router.use(authenticate);

router.get("/schedule", mentorSchedule);
router.post("/meetings", scheduleMeeting);

export default router;
