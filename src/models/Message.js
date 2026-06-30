import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  classroom: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', index: true },
  kind: { type: String, enum: ['message', 'announcement'], default: 'message', index: true },
  priority: { type: String, enum: ['normal', 'important', 'urgent'], default: 'normal' },
  content: { type: String, required: true, trim: true, maxlength: 5000 },
  attachments: [{ name: String, url: String, fileType: String, size: Number }],
  readBy: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, readAt: Date }],
  parentMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  pinned: { type: Boolean, default: false },
  moderated: {
    status: { type: String, enum: ['visible', 'flagged', 'hidden'], default: 'visible', index: true },
    reason: { type: String, trim: true, maxlength: 500 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
  },
}, { timestamps: true });

messageSchema.index({ classroom: 1, kind: 1, createdAt: -1 });

export default mongoose.model('Message', messageSchema);