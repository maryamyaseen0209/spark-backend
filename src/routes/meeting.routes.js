import { Router } from 'express';
import { cancelMeeting, createMeeting, disconnectZoom, getZoomConnectionStatus, listMeetings, sendMeetingReminders, startZoomConnect, inviteTeacherToZoom } from '../controllers/meeting.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.use(requireAuth);
router.get('/', listMeetings);
router.get('/zoom/status', getZoomConnectionStatus);
router.post('/zoom/connect', startZoomConnect);
router.post('/zoom/invite-teacher', inviteTeacherToZoom);
router.delete('/zoom/disconnect', disconnectZoom);
router.post('/', createMeeting);
router.post('/reminders/run', sendMeetingReminders);
router.patch('/:id/cancel', cancelMeeting);

export default router;