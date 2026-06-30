import Classroom from '../models/Classroom.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import Quiz from '../models/Quiz.js';
import QuizAttempt from '../models/QuizAttempt.js';
import { aiService } from '../services/ai.service.js';
import { emitNotification, emitToClassroom } from '../services/realtime.service.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import mammoth from 'mammoth';
import * as pdfParseModule from 'pdf-parse';

const populateQuiz = (query) => query.populate('teacher', 'fullName email').populate('classroom', 'name subject joinCode students');

async function extractPdfText(buffer) {
  const pdfParse = pdfParseModule.default || pdfParseModule;
  if (typeof pdfParse === 'function') {
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  if (pdfParse.PDFParse) {
    const parser = new pdfParse.PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text;
    } finally {
      await parser.destroy();
    }
  }

  throw new Error('PDF parser is not available.');
}

async function extractDocumentText(file) {
  if (!file) throw new ApiError(400, 'Upload a PDF, DOCX, TXT, MD, or CSV document to generate a quiz.');
  const lowerName = file.originalname.toLowerCase();
  let text = '';

  if (file.mimetype === 'application/pdf' || lowerName.endsWith('.pdf')) {
    text = await extractPdfText(file.buffer);
  } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    text = parsed.value;
  } else if (file.mimetype.startsWith('text/') || lowerName.endsWith('.txt') || lowerName.endsWith('.md') || lowerName.endsWith('.csv')) {
    text = file.buffer.toString('utf8');
  } else {
    throw new ApiError(400, 'Unsupported document type. Upload PDF, DOCX, TXT, MD, or CSV.');
  }

  const cleanedText = text.replace(/\s+/g, ' ').trim();
  if (cleanedText.length < 100) throw new ApiError(400, 'Could not read enough text from this document to generate a quiz.');
  return cleanedText;
}

function sanitizeQuestions(questions = []) {
  return questions.map((question) => ({
    ...(question.toObject?.() || question),
    options: (question.options || []).map((option) => ({ text: option.text })),
  }));
}

function canManageQuiz(user, quiz) {
  return user.role === 'admin' || quiz.teacher.equals(user._id);
}

async function createQuizChatMessage(req, classroom, quiz, content, priority = 'important') {
  const message = await Message.create({
    sender: req.user._id,
    classroom: classroom._id,
    kind: 'announcement',
    priority,
    pinned: priority !== 'normal',
    content,
    readBy: [{ user: req.user._id, readAt: new Date() }],
  });
  const populated = await Message.findById(message._id).populate('sender', 'fullName email role avatarUrl');
  emitToClassroom(req, classroom._id, 'message:new', { message: populated });
  return populated;
}

async function notifyQuizRecipients(req, classroom, quiz, messageRef, title, message, type = 'quiz_published') {
  const recipients = (classroom.students || []).filter((student) => !student.equals(req.user._id));
  const docs = recipients.map((recipient) => ({
    recipient,
    actor: req.user._id,
    classroom: classroom._id,
    messageRef,
    quizRef: quiz._id,
    type,
    title,
    message,
  }));
  const notifications = docs.length ? await Notification.insertMany(docs, { ordered: false }).catch(() => []) : [];
  notifications.forEach((notification) => emitNotification(req, notification));
}

function scoreAttempt(quiz, answers = []) {
  const answerMap = new Map(answers.map((answer) => [Number(answer.questionIndex), answer.selectedOptionIndex]));
  const totalQuestions = quiz.questions.length;
  let correctCount = 0;
  const scoredAnswers = quiz.questions.map((question, questionIndex) => {
    const selectedOptionIndex = answerMap.has(questionIndex) ? Number(answerMap.get(questionIndex)) : null;
    const correctOptionIndex = (question.options || []).findIndex((option) => option.isCorrect);
    const isCorrect = selectedOptionIndex !== null && selectedOptionIndex === correctOptionIndex;
    if (isCorrect) correctCount += 1;
    return { questionIndex, selectedOptionIndex, isCorrect, pointsAwarded: isCorrect ? 1 : 0 };
  });
  const score = totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0;
  return { answers: scoredAnswers, score, correctCount, totalQuestions, passed: score >= quiz.passingScore };
}

function resultPayload(quiz, attempt) {
  return {
    attempt,
    quiz: {
      _id: quiz._id,
      title: quiz.title,
      subject: quiz.subject,
      passingScore: quiz.passingScore,
      questions: quiz.questions.map((question, index) => ({
        text: question.text,
        options: question.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
        explanation: question.explanation || 'Review the correct option and revisit this learning objective.',
        difficulty: question.difficulty,
        learningObjective: question.learningObjective,
        selectedOptionIndex: attempt.answers.find((answer) => answer.questionIndex === index)?.selectedOptionIndex ?? null,
      })),
    },
  };
}

export const listQuizzes = asyncHandler(async (req, res) => {
  let query = {};
  if (req.user.role === 'teacher') query = { teacher: req.user._id };
  if (req.user.role === 'student') {
    const classrooms = await Classroom.find({ students: req.user._id }).select('_id');
    query = { classroom: { $in: classrooms.map((classroom) => classroom._id) }, status: 'published' };
  }

  const quizzes = await populateQuiz(Quiz.find(query)).sort({ createdAt: -1 });
  const attempts = req.user.role === 'student'
    ? await QuizAttempt.find({ student: req.user._id, quiz: { $in: quizzes.map((quiz) => quiz._id) }, status: 'submitted' }).select('quiz score passed submittedAt')
    : [];
  const attemptByQuiz = new Map(attempts.map((attempt) => [String(attempt.quiz), attempt]));
  const payload = quizzes.map((quiz) => ({
    ...quiz.toObject(),
    questions: req.user.role === 'student' ? sanitizeQuestions(quiz.questions) : quiz.questions,
    latestAttempt: attemptByQuiz.get(String(quiz._id)) || null,
  }));
  res.json({ success: true, quizzes: payload });
});

export const createQuiz = asyncHandler(async (req, res) => {
  throw new ApiError(405, 'Manual quiz creation is disabled. Generate quizzes from uploaded learning documents with AI, then preview/edit before publishing.');
});

export const generateQuizFromDocument = asyncHandler(async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') throw new ApiError(403, 'Only teachers can generate quizzes');

  const classroom = await Classroom.findById(req.body.classroom);
  if (!classroom) throw new ApiError(404, 'Classroom not found');
  if (req.user.role !== 'admin' && !classroom.teacher.equals(req.user._id)) throw new ApiError(403, 'You cannot create quizzes for this classroom');

  const sourceText = await extractDocumentText(req.file);
  const totalQuestions = Math.min(Math.max(Number(req.body.totalQuestions || 10), 1), 20);
  const questions = await aiService.generateQuizQuestions({
    sourceText,
    totalQuestions,
    difficulty: req.body.difficulty || 'mixed',
    questionType: req.body.questionType || 'multiple-choice',
  });

  if (!questions.length) throw new ApiError(502, 'AI did not return usable quiz questions. Try a clearer document.');

  const quiz = await Quiz.create({
    title: req.body.title,
    subject: req.body.subject,
    classroom: classroom._id,
    teacher: req.user._id,
    description: req.body.description || `AI generated from ${req.file.originalname}. Preview and edit before publishing.`,
    durationMinutes: Number(req.body.durationMinutes || 30),
    passingScore: Number(req.body.passingScore || 60),
    dueAt: req.body.dueAt || undefined,
    questionType: req.body.questionType || 'multiple-choice',
    status: 'draft',
    questions,
    generationMetadata: { source: req.file.originalname, model: aiService.models.reasoning },
  });

  const generatedMessage = await createQuizChatMessage(
    req,
    classroom,
    quiz,
    `${req.user.fullName} generated a new AI quiz draft: ${quiz.title}. It will appear for students after the teacher publishes it.`,
    'normal',
  );
  await notifyQuizRecipients(
    req,
    classroom,
    quiz,
    generatedMessage._id,
    'AI quiz draft generated',
    `${req.user.fullName} generated ${quiz.title} for ${classroom.name}. Watch chat for publishing updates.`,
    'announcement_posted',
  );

  res.status(201).json({ success: true, message: 'AI quiz draft generated. Please preview, edit, and publish when ready.', quiz });
});

export const updateQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  if (!canManageQuiz(req.user, quiz)) throw new ApiError(403, 'You cannot update this quiz');
  ['title', 'description', 'subject', 'classroom', 'questions', 'durationMinutes', 'passingScore', 'scheduledAt', 'dueAt', 'status', 'questionType'].forEach((field) => {
    if (req.body[field] !== undefined) quiz[field] = req.body[field];
  });
  await quiz.save();
  res.json({ success: true, message: 'Quiz updated successfully.', quiz });
});

export const publishQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id).populate('classroom');
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  if (!canManageQuiz(req.user, quiz)) throw new ApiError(403, 'You cannot publish this quiz');
  if (!quiz.questions.length) throw new ApiError(400, 'Add at least one question before publishing');
  quiz.status = 'published';
  if (req.body?.dueAt !== undefined) quiz.dueAt = req.body.dueAt || undefined;
  if (req.body?.durationMinutes !== undefined) quiz.durationMinutes = Number(req.body.durationMinutes || quiz.durationMinutes);
  await quiz.save();
  const dueCopy = quiz.dueAt ? ` Deadline: ${new Date(quiz.dueAt).toLocaleString()}.` : '';
  const announcement = await createQuizChatMessage(req, quiz.classroom, quiz, `New quiz published: ${quiz.title}. Duration: ${quiz.durationMinutes} minutes.${dueCopy} Open AI Quizzes to start.`);
  await notifyQuizRecipients(req, quiz.classroom, quiz, announcement._id, 'New quiz published', `${quiz.title} is available in ${quiz.classroom.name}.${dueCopy}`);
  emitToClassroom(req, quiz.classroom._id, 'quiz:published', { quiz });
  res.json({ success: true, message: 'Quiz published to enrolled students.', quiz });
});

export const deleteQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  if (!canManageQuiz(req.user, quiz)) throw new ApiError(403, 'You cannot delete this quiz');
  await QuizAttempt.deleteMany({ quiz: quiz._id });
  await quiz.deleteOne();
  res.json({ success: true, message: 'Quiz and attempts deleted.' });
});

export const startQuiz = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new ApiError(403, 'Only students can take quizzes');
  const quiz = await populateQuiz(Quiz.findById(req.params.id));
  if (!quiz || quiz.status !== 'published') throw new ApiError(404, 'Published quiz not found');
  if (!quiz.classroom.students.some((student) => student.equals(req.user._id))) throw new ApiError(403, 'You are not enrolled in this quiz classroom');
  const submittedAttempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id, status: 'submitted' });
  if (submittedAttempt) throw new ApiError(409, 'You have already submitted this quiz. Your marks are visible on the quiz card.');
  let attempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id, status: 'in_progress' });
  if (!attempt) attempt = await QuizAttempt.create({ quiz: quiz._id, student: req.user._id, classroom: quiz.classroom._id, totalQuestions: quiz.questions.length });
  res.json({ success: true, quiz: { ...quiz.toObject(), questions: sanitizeQuestions(quiz.questions) }, attempt, endsAt: new Date(attempt.startedAt.getTime() + quiz.durationMinutes * 60 * 1000) });
});

export const submitQuiz = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new ApiError(403, 'Only students can submit quizzes');
  const quiz = await Quiz.findById(req.params.id).populate('classroom');
  if (!quiz || quiz.status !== 'published') throw new ApiError(404, 'Published quiz not found');
  if (!quiz.classroom.students.some((student) => student.equals(req.user._id))) throw new ApiError(403, 'You are not enrolled in this quiz classroom');
  const submittedAttempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id, status: 'submitted' });
  if (submittedAttempt) throw new ApiError(409, 'This quiz has already been submitted.');
  const inProgressAttempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id, status: 'in_progress' });
  if (inProgressAttempt) {
    const endsAt = new Date(inProgressAttempt.startedAt.getTime() + quiz.durationMinutes * 60 * 1000);
    if (new Date() > endsAt) req.body.answers = [];
  }
  const scored = scoreAttempt(quiz, req.body.answers || []);
  const attempt = await QuizAttempt.findOneAndUpdate(
    { quiz: quiz._id, student: req.user._id, status: 'in_progress' },
    { ...scored, classroom: quiz.classroom._id, submittedAt: new Date(), status: 'submitted' },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  await Notification.create({ recipient: quiz.teacher, actor: req.user._id, classroom: quiz.classroom._id, type: 'quiz_submitted', title: 'Quiz submitted', message: `${req.user.fullName} scored ${attempt.score}% on ${quiz.title}.` });
  res.json({ success: true, message: `Quiz submitted. Score: ${attempt.score}%`, ...resultPayload(quiz, attempt) });
});

export const getAttemptResult = asyncHandler(async (req, res) => {
  const attempt = await QuizAttempt.findById(req.params.attemptId);
  if (!attempt) throw new ApiError(404, 'Attempt not found');
  const quiz = await Quiz.findById(attempt.quiz);
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  if (req.user.role === 'student' && !attempt.student.equals(req.user._id)) throw new ApiError(403, 'You cannot view this result');
  if (req.user.role === 'teacher' && !quiz.teacher.equals(req.user._id)) throw new ApiError(403, 'You cannot view this result');
  res.json({ success: true, ...resultPayload(quiz, attempt) });
});

export const getQuizAnalytics = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  if (!canManageQuiz(req.user, quiz)) throw new ApiError(403, 'You cannot view analytics for this quiz');
  const attempts = await QuizAttempt.find({ quiz: quiz._id, status: 'submitted' }).populate('student', 'fullName email');
  const averageScore = attempts.length ? Math.round(attempts.reduce((sum, attempt) => sum + attempt.score, 0) / attempts.length) : 0;
  res.json({ success: true, analytics: { attempts, averageScore, submissions: attempts.length, passCount: attempts.filter((attempt) => attempt.passed).length } });
});