import { Router } from 'express';
import { createAnnouncement, createModerationCase, deleteAnnouncement, getAdminOverview, getPermissions, getPlatformAnalytics, listAnnouncements, listAuditLogs, listModerationCases, listSystemConfig, listUsers, updateAnnouncement, updateModerationCase, updateUserAdmin, upsertSystemConfig } from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.get('/overview', getAdminOverview);
router.get('/analytics', getPlatformAnalytics);
router.get('/users', listUsers);
router.patch('/users/:id', updateUserAdmin);
router.get('/announcements', listAnnouncements);
router.post('/announcements', createAnnouncement);
router.patch('/announcements/:id', updateAnnouncement);
router.delete('/announcements/:id', deleteAnnouncement);
router.get('/audit-logs', listAuditLogs);
router.get('/moderation', listModerationCases);
router.post('/moderation', createModerationCase);
router.patch('/moderation/:id', updateModerationCase);
router.get('/config', listSystemConfig);
router.put('/config', upsertSystemConfig);
router.get('/permissions', getPermissions);

export default router;