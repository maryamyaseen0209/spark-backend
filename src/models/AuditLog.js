import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  action: { type: String, required: true, trim: true, maxlength: 120, index: true },
  entityType: { type: String, trim: true, maxlength: 80, index: true },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  summary: { type: String, required: true, trim: true, maxlength: 500 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: String,
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });

export default mongoose.model('AuditLog', auditLogSchema);