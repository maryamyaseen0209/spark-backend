import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res, next) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  if (statusCode >= 500) logger.error(err.message, { stack: err.stack, details: err.details });
  else logger.warn(err.message, { statusCode, details: err.details });
  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal server error' : err.message,
    details: err.details || undefined,
  });
}
