import { Router } from 'express';
import { body } from 'express-validator';
import multer from 'multer';
import { deleteAssignment, generateAssignment, generateQuizDraft, listAssignments, updateAssignment } from '../controllers/assignment.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);
router.get('/', listAssignments);
router.post('/generate', upload.single('document'), [body('topic').trim().isLength({ min: 3 }).withMessage('Topic is required')], validate, generateAssignment);
router.patch('/:id', updateAssignment);
router.delete('/:id', deleteAssignment);
router.post('/quiz-draft', [body('title').trim().isLength({ min: 3 }), body('subject').trim().isLength({ min: 2 }), body('classroom').isMongoId(), body('sourceText').trim().isLength({ min: 40 }).withMessage('Paste at least 40 characters of source material')], validate, generateQuizDraft);

export default router;
