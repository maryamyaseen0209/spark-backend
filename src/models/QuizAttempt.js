import mongoose from 'mongoose';

const answerSchema = new mongoose.Schema({
  questionIndex: { type: Number, required: true },
  selectedOptionIndex: { type: Number, default: null },
  isCorrect: { type: Boolean, default: false },
  pointsAwarded: { type: Number, default: 0 },
}, { _id: false });

const quizAttemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  classroom: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', index: true },
  answers: [answerSchema],
  score: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  totalQuestions: { type: Number, default: 0 },
  passed: { type: Boolean, default: false },
  startedAt: { type: Date, default: Date.now },
  submittedAt: Date,
  status: { type: String, enum: ['in_progress', 'submitted'], default: 'in_progress', index: true },
}, { timestamps: true });

quizAttemptSchema.index({ quiz: 1, student: 1, status: 1 });
quizAttemptSchema.index({ student: 1, submittedAt: -1 });

export default mongoose.model('QuizAttempt', quizAttemptSchema);