import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../controllers/notification.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', listNotifications);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);

export default router;