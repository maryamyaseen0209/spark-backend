import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { listAnnouncements, listConversations, listMessages, markThreadRead, moderateMessage, sendMessage } from '../controllers/message.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/conversations', listConversations);
router.get('/announcements', listAnnouncements);
router.get('/', listMessages);
router.post('/', sendMessage);
router.patch('/read', markThreadRead);
router.patch('/:id/moderate', moderateMessage);

export default router;