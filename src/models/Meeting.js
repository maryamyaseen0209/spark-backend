import mongoose from 'mongoose';

const meetingSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1000 },
  classroom: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  startsAt: { type: Date, required: true, index: true },
  durationMinutes: { type: Number, default: 45, min: 10, max: 240 },
  provider: { type: String, enum: ['zoom', 'jitsi', 'manual'], default: 'zoom' },
  status: { type: String, enum: ['scheduled', 'cancelled', 'completed'], default: 'scheduled', index: true },
  joinUrl: String,
  startUrl: String,
  providerMeetingId: String,
  providerStatus: { type: String, enum: ['configured', 'configuration_required', 'manual', 'cancelled', 'failed'], default: 'configuration_required' },
  providerMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  reminderSentAt: Date,
  attendees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

meetingSchema.index({ classroom: 1, startsAt: 1 });

export default mongoose.model('Meeting', meetingSchema);