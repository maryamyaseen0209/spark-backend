import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  body: { type: String, required: true, trim: true, maxlength: 2000 },
  audience: { type: String, enum: ['all', 'students', 'teachers', 'admins'], default: 'all', index: true },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  publishedAt: Date,
}, { timestamps: true });

export default mongoose.model('Announcement', announcementSchema);