import Assignment from '../models/Assignment.js';
import Classroom from '../models/Classroom.js';
import Quiz from '../models/Quiz.js';
import { aiService } from '../services/ai.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/apiError.js';

const asSections = (text) => {
  const parts = String(text || '').split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  return {
    introduction: parts[0] || 'Generated assignment draft.',
    bodySections: parts.slice(1, -1).map((body, index) => ({ heading: `Section ${index + 1}`, body })),
    conclusion: parts.at(-1) || '',
    references: [],
  };
};

export const listAssignments = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new ApiError(403, 'Only students can access assignments');
  const assignments = await Assignment.find({ student: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, assignments, aiConfigured: aiService.isConfigured() });
});

export const generateAssignment = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new ApiError(403, 'Only students can generate assignments');
  const { topic, wordCount = 800, difficulty = 'intermediate', references = false } = req.body;
  const includeReferences = references === true || references === 'true' || references === 'on';
  const raw = await aiService.generateAssignment({ topic, wordCount, difficulty, references: includeReferences });
  const assignment = await Assignment.create({
    student: req.user._id,
    topic,
    wordCount,
    difficulty,
    content: asSections(raw),
    generationMetadata: { model: aiService.isConfigured() ? 'groq' : 'dev-fallback', promptTokens: 0, completionTokens: 0 },
  });
  res.status(201).json({ success: true, message: aiService.isConfigured() ? 'Assignment answer generated with AI.' : 'Assignment generated with dev fallback. Add GROQ_API_KEY for live AI.', assignment });
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findOne({ _id: req.params.id, student: req.user._id });
  if (!assignment) throw new ApiError(404, 'Assignment not found');
  Object.assign(assignment, req.body);
  await assignment.save();
  res.json({ success: true, message: 'Assignment updated.', assignment });
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findOneAndDelete({ _id: req.params.id, student: req.user._id });
  if (!assignment) throw new ApiError(404, 'Assignment not found');
  res.json({ success: true, message: 'Assignment deleted.' });
});

const normalizeQuestions = (raw, fallbackTitle) => {
  try {
    const parsed = JSON.parse(String(raw).replace(/^```json|```$/g, '').trim());
    const items = Array.isArray(parsed) ? parsed : parsed.questions;
    if (Array.isArray(items) && items.length) {
      return items.map((item) => {
        const options = (item.options || ['A', 'B', 'C', 'D']).map((option, index) => ({
          text: typeof option === 'string' ? option : option.text,
          isCorrect: typeof option === 'object' ? Boolean(option.isCorrect) : String(option) === String(item.correctAnswer),
        }));
        if (!options.some((option) => option.isCorrect)) options[0].isCorrect = true;
        return { text: item.question || item.text || fallbackTitle, options, explanation: item.explanation || 'Review the source material for support.', difficulty: ['easy', 'medium', 'hard'].includes(item.difficulty) ? item.difficulty : 'medium', learningObjective: item.learningObjective || '' };
      });
    }
  } catch {}
  return [1, 2, 3, 4, 5].map((n) => ({ text: `${fallbackTitle} checkpoint ${n}`, options: [{ text: 'Correct concept from source', isCorrect: true }, { text: 'Related distractor', isCorrect: false }, { text: 'Common misconception', isCorrect: false }, { text: 'Unrelated answer', isCorrect: false }], explanation: 'Dev fallback question. Add GROQ_API_KEY for AI-generated questions.', difficulty: 'medium', learningObjective: 'Understand source material' }));
};

export const generateQuizDraft = asyncHandler(async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') throw new ApiError(403, 'Only teachers can generate quiz drafts');
  const { title, subject, classroom, sourceText, totalQuestions = 5, difficulty = 'mixed' } = req.body;
  const room = await Classroom.findById(classroom);
  if (!room) throw new ApiError(404, 'Classroom not found');
  if (req.user.role !== 'admin' && !room.teacher.equals(req.user._id)) throw new ApiError(403, 'You cannot generate quizzes for this classroom');
  const raw = await aiService.generateQuizQuestions({ sourceText, totalQuestions, difficulty });
  const quiz = await Quiz.create({ title, subject, classroom, teacher: req.user._id, description: `AI draft from ${Math.min(String(sourceText).length, 2000)} source characters.`, questions: normalizeQuestions(raw, title), generationMetadata: { source: 'text-upload', model: aiService.isConfigured() ? 'groq' : 'dev-fallback' } });
  res.status(201).json({ success: true, message: aiService.isConfigured() ? 'AI quiz draft generated.' : 'Dev fallback quiz generated. Add GROQ_API_KEY for live AI.', quiz });
});
