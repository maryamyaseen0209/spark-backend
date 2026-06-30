import mongoose from 'mongoose';

const classroomSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  subject: { type: String, required: true, trim: true, maxlength: 100 },
  gradeLevel: { type: String, trim: true, maxlength: 60 },
  section: { type: String, trim: true, maxlength: 40 },
  academicYear: { type: String, trim: true, maxlength: 20 },
  description: { type: String, trim: true, maxlength: 1000 },
  joinCode: { type: String, required: true, unique: true, uppercase: true, index: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  communicationSettings: {
    studentMessagingEnabled: { type: Boolean, default: true },
    announcementsOnly: { type: Boolean, default: false },
    commentsEnabled: { type: Boolean, default: true },
  },
  status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
}, { timestamps: true });

export default mongoose.model('Classroom', classroomSchema);