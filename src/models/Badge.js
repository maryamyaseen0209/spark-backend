import mongoose from 'mongoose';

const badgeSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  category: { type: String, enum: ['quiz', 'streak', 'assignment', 'performance', 'engagement'], default: 'engagement', index: true },
  goal: { type: Number, required: true, min: 1 },
  metric: { type: String, required: true, enum: ['attempts', 'streak', 'assignments', 'averageScore'] },
  icon: { type: String, default: 'Medal' },
  points: { type: Number, default: 50, min: 0 },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

badgeSchema.index({ category: 1, isActive: 1 });

export default mongoose.model('Badge', badgeSchema);