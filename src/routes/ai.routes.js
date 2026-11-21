import { Router } from 'express';
import { body } from 'express-validator';
import { askTutor, getAiStatus, summarizeStudyNotes } from '../controllers/ai.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/status', getAiStatus);

router.post(
  '/tutor',
  [
    body('question').trim().isLength({ min: 2 }).withMessage('Question must be at least 2 characters.'),
    body('subject').optional().isString(),
    body('persona').optional().isString(),
    body('conversationHistory').optional().isArray(),
  ],
  validate,
  askTutor
);

router.post(
  '/summarize',
  [
    body('text').trim().isLength({ min: 20 }).withMessage('Text must be at least 20 characters.'),
    body('format').optional().isIn(['bullet_points', 'flashcards', 'cheat_sheet']),
  ],
  validate,
  summarizeStudyNotes
);

export default router;
