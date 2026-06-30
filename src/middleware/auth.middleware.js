import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import User from '../models/User.js';

export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.replace('Bearer ', '') : req.cookies.accessToken;
    if (!token) throw new ApiError(401, 'Authentication required');
    const payload = jwt.verify(token, env.jwtAccessSecret);
    const user = await User.findById(payload.sub).select('-password');
    if (!user || user.status !== 'active') throw new ApiError(401, 'Invalid or inactive account');
    req.user = user;
    next();
  } catch (error) {
    next(error.statusCode ? error : new ApiError(401, 'Invalid or expired access token'));
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) return next(new ApiError(403, 'You do not have permission to access this resource'));
  next();
};
