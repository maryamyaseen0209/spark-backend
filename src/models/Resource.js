import mongoose from 'mongoose';

const resourceCommentSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  body: { type: String, required: true, trim: true, maxlength: 1200 },
  parentComment: { type: mongoose.Schema.Types.ObjectId },
  upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pinned: { type: Boolean, default: false },
  moderated: { type: Boolean, default: false },
  deletedAt: Date,
}, { timestamps: true });

const resourceSchema = new mongoose.Schema({
  classroom: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 1500 },
  type: { type: String, enum: ['document', 'video', 'link', 'image', 'other'], default: 'other', index: true },
  url: { type: String, required: true },
  storageProvider: { type: String, enum: ['local', 'cloudinary', 'external'], default: 'local' },
  publicId: String,
  originalName: String,
  mimeType: String,
  size: Number,
  tags: [{ type: String, trim: true, maxlength: 40 }],
  downloads: { type: Number, default: 0 },
  previewCount: { type: Number, default: 0 },
  commentsEnabled: { type: Boolean, default: true },
  pinned: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'archived', 'flagged'], default: 'active', index: true },
  comments: [resourceCommentSchema],
}, { timestamps: true });

resourceSchema.index({ classroom: 1, createdAt: -1 });
resourceSchema.index({ title: 'text', description: 'text', tags: 'text' });

export default mongoose.model('Resource', resourceSchema);