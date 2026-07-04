import mongoose from 'mongoose';

const emailVerificationSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['student', 'teacher'], required: true },
  institution: { type: String, trim: true, maxlength: 160 },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

emailVerificationSchema.index({ email: 1, createdAt: -1 });

export default mongoose.model('EmailVerification', emailVerificationSchema);