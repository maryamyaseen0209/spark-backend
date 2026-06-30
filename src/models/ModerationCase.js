import mongoose from 'mongoose';

const moderationCaseSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  reason: { type: String, required: true, trim: true, maxlength: 240 },
  details: { type: String, trim: true, maxlength: 1500 },
  status: { type: String, enum: ['open', 'reviewing', 'resolved', 'dismissed'], default: 'open', index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolution: { type: String, trim: true, maxlength: 1000 },
}, { timestamps: true });

export default mongoose.model('ModerationCase', moderationCaseSchema);