import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const sessionSchema = new mongoose.Schema({
  refreshTokenHash: { type: String, required: true },
  userAgent: String,
  ip: String,
  lastActiveAt: { type: Date, default: Date.now },
  expiresAt: Date,
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  password: { type: String, required: true, minlength: 8, select: false },
  role: { type: String, enum: ['student', 'teacher', 'admin'], required: true, index: true },
  status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'pending', index: true },
  emailVerified: { type: Boolean, default: false },
  institution: { type: String, trim: true, maxlength: 160 },
  avatarUrl: String,
  bio: String,
  preferences: {
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    language: { type: String, default: 'en' },
    emailNotifications: { type: Boolean, default: true },
  },
  learningStreak: {
    current: { type: Number, default: 0 },
    lastActivityAt: Date,
  },
  experiencePoints: { type: Number, default: 0 },
  badges: [{ badge: { type: mongoose.Schema.Types.ObjectId, ref: 'Badge' }, unlockedAt: Date }],
  zoomOAuth: {
    accessToken: { type: String, select: false },
    refreshToken: { type: String, select: false },
    expiresAt: Date,
    zoomUserId: String,
    email: String,
    accountId: String,
    connectedAt: Date,
  },
  sessions: [sessionSchema],
  passwordResetVersion: { type: Number, default: 0 },
  resetCodeHash: { type: String, select: false },
  resetCodeExpiresAt: Date,
  suspension: { reason: String, expiresAt: Date },
}, { timestamps: true });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model('User', userSchema);
