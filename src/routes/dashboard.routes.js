import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { exportAnalytics, getBadges, getDashboard, getLeaderboard, getProgressAnalytics, getReportOverview } from '../controllers/dashboard.controller.js';

const router = Router();

router.get('/', requireAuth, getDashboard);
router.get('/analytics/progress', requireAuth, getProgressAnalytics);
router.get('/analytics/export', requireAuth, exportAnalytics);
router.get('/leaderboard', requireAuth, getLeaderboard);
router.get('/badges', requireAuth, getBadges);
router.get('/reports/overview', requireAuth, getReportOverview);

export default router;