import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  options: [{ text: String, isCorrect: Boolean }],
  explanation: String,
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  learningObjective: String,
}, { _id: false });

const quizSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: String,
  subject: { type: String, required: true, trim: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  classroom: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', index: true },
  questions: [questionSchema],
  durationMinutes: { type: Number, default: 30 },
  passingScore: { type: Number, default: 60 },
  scheduledAt: Date,
  dueAt: Date,
  status: { type: String, enum: ['draft', 'published', 'scheduled', 'expired'], default: 'draft', index: true },
  questionType: { type: String, enum: ['multiple-choice', 'short-answer', 'true-false', 'mixed'], default: 'multiple-choice' },
  generationMetadata: { source: String, model: String, promptTokens: Number, completionTokens: Number },
}, { timestamps: true });

quizSchema.index({ teacher: 1, status: 1, createdAt: -1 });
quizSchema.index({ classroom: 1, status: 1, scheduledAt: 1 });

export default mongoose.model('Quiz', quizSchema);