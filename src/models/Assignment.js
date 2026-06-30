import mongoose from 'mongoose';

const assignmentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  topic: { type: String, required: true, trim: true },
  wordCount: { type: Number, min: 500, max: 2000, default: 1000 },
  difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
  content: {
    introduction: String,
    bodySections: [{ heading: String, body: String }],
    conclusion: String,
    references: [String],
  },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  generationMetadata: { model: String, promptTokens: Number, completionTokens: Number },
}, { timestamps: true });

export default mongoose.model('Assignment', assignmentSchema);