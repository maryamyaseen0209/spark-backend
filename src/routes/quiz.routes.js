import { Router } from 'express';
import { body } from 'express-validator';
import multer from 'multer';
import { deleteQuiz, generateQuizFromDocument, getAttemptResult, getQuizAnalytics, listQuizzes, publishQuiz, startQuiz, submitQuiz, updateQuiz } from '../controllers/quiz.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const questionValidators = [
  body('questions').optional().isArray().withMessage('Questions must be an array'),
  body('questions.*.text').optional().trim().isLength({ min: 3 }).withMessage('Question text is required'),
  body('questions.*.options').optional().isArray({ min: 2 }).withMessage('Each question needs at least two options'),
];

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);
router.get('/', listQuizzes);
router.post('/generate-from-document', upload.single('document'), generateQuizFromDocument);
router.patch('/:id', questionValidators, validate, updateQuiz);
router.patch('/:id/publish', publishQuiz);
router.delete('/:id', deleteQuiz);
router.post('/:id/start', startQuiz);
router.post('/:id/submit', [body('answers').isArray().withMessage('Answers are required')], validate, submitQuiz);
router.get('/:id/analytics', getQuizAnalytics);
router.get('/attempts/:attemptId', getAttemptResult);

export default router;