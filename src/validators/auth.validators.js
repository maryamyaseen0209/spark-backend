import { body } from 'express-validator';

export const startRegistrationValidator = [
  body('fullName').trim().isLength({ min: 2, max: 120 }).withMessage('Full name must be 2-120 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match'),
  body('role').isIn(['student', 'teacher']).withMessage('Public registration is limited to student or teacher accounts'),
  body('termsAccepted').equals('true').withMessage('Terms acceptance is required'),
  body('institution').optional({ checkFalsy: true }).trim().isLength({ max: 160 }),
];

export const registerValidator = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('code').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('A 6-digit verification code is required'),
];

export const loginValidator = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  body('rememberMe').optional().isBoolean(),
];

export const forgotPasswordValidator = [body('email').isEmail().normalizeEmail()];

export const resetPasswordValidator = [
  body('token').optional(),
  body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required when using a code'),
  body('code').optional().trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('A 6-digit reset code is required when using email reset'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body().custom((value) => {
    if (!value.token && (!value.email || !value.code)) {
      throw new Error('Token or email + code is required');
    }
    return true;
  }),
];

export const updateProfileValidator = [
  body('fullName').trim().isLength({ min: 2, max: 120 }).withMessage('Full name must be 2-120 characters'),
  body('institution').optional({ checkFalsy: true }).trim().isLength({ max: 160 }).withMessage('Institution must be 160 characters or fewer'),
  body('bio').optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage('Bio must be 500 characters or fewer'),
  body('preferences.theme').optional().isIn(['light', 'dark', 'system']).withMessage('Theme must be light, dark, or system'),
  body('preferences.language').optional().trim().isLength({ min: 2, max: 12 }).withMessage('Language must be 2-12 characters'),
  body('preferences.emailNotifications').optional().isBoolean().withMessage('Email notifications must be true or false'),
];
