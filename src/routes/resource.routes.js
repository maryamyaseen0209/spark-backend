import { Router } from 'express';
import multer from 'multer';
import { body } from 'express-validator';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { addComment, createResource, deleteResource, listResources, recordResourceView, updateComment, updateResource } from '../controllers/resource.controller.js';
import { allowedResourceMimeTypes } from '../services/uploads.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(allowedResourceMimeTypes.has(file.mimetype) ? null : new Error('Unsupported resource file type'), allowedResourceMimeTypes.has(file.mimetype)),
});

const router = Router();

router.use(requireAuth);
router.get('/', listResources);
router.post('/', requireRole('teacher'), upload.single('file'), [body('classroomId').isMongoId().withMessage('Choose a classroom'), body('title').trim().isLength({ min: 2 }).withMessage('Resource title is required')], validate, createResource);
router.patch('/:id', updateResource);
router.delete('/:id', deleteResource);
router.post('/:id/view', recordResourceView);
router.post('/:id/comments', [body('body').trim().isLength({ min: 1, max: 1200 }).withMessage('Comment is required')], validate, addComment);
router.patch('/:id/comments/:commentId', updateComment);

export default router;