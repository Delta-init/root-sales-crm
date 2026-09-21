import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  mentorSchedule, scheduleMeeting, meetingDetail, updateMeeting, cancelMeeting,
} from "../controllers/mentorController.js";

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

/*
 * Reading, changing and calling off one meeting.
 *
 * Open to anybody signed in, like the rest of this router — the refusal lives
 * on the far side, where the meeting is, and it is the same one either way:
 * the person who arranged it, or somebody who administers the portal.
 */
router.get("/meetings/:meetingId", meetingDetail);
router.patch("/meetings/:meetingId", updateMeeting);
router.post("/meetings/:meetingId/cancel", cancelMeeting);

export default router;
