import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  classroom: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom' },
  messageRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  quizRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' },
  resourceRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource' },
  type: { type: String, enum: ['classroom_enrollment', 'classroom_removed', 'classroom_updated', 'quiz_published', 'quiz_submitted', 'message_received', 'announcement_posted', 'message_flagged', 'read_receipt', 'profile_updated', 'resource_added', 'resource_commented', 'meeting_scheduled', 'meeting_reminder'], required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  readAt: Date,
}, { timestamps: true });

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);