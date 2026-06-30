import { Router } from 'express';
import { body } from 'express-validator';
import { addStudent, createClassroom, deleteClassroom, getClassroom, joinClassroom, leaveClassroom, listClassrooms, regenerateJoinCode, removeStudent, updateClassroom } from '../controllers/classroom.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router = Router();

router.use(requireAuth);
router.get('/', listClassrooms);
router.post('/', [body('name').trim().isLength({ min: 2 }).withMessage('Classroom name is required'), body('subject').trim().isLength({ min: 2 }).withMessage('Subject is required')], validate, createClassroom);
router.post('/join', [body('joinCode').trim().isLength({ min: 6, max: 6 }).withMessage('Enter a 6-character join code')], validate, joinClassroom);
router.get('/:id', getClassroom);
router.patch('/:id', [body('name').optional().trim().isLength({ min: 2 }).withMessage('Classroom name must be at least 2 characters'), body('subject').optional().trim().isLength({ min: 2 }).withMessage('Subject must be at least 2 characters')], validate, updateClassroom);
router.delete('/:id', deleteClassroom);
router.patch('/:id/regenerate-code', regenerateJoinCode);
router.post('/:id/leave', leaveClassroom);
router.post('/:id/students', [body('email').isEmail().withMessage('Enter a valid student email')], validate, addStudent);
router.delete('/:id/students/:studentId', removeStudent);

export default router;