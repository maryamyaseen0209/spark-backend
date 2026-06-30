import AuditLog from '../models/AuditLog.js';

export function writeAuditLog({ req, action, entityType, entityId, summary, metadata = {} }) {
  return AuditLog.create({
    actor: req.user?._id,
    action,
    entityType,
    entityId,
    summary,
    metadata,
    ip: req.ip,
  });
}