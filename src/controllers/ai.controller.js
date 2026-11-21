import { aiService } from '../services/ai.service.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getAiStatus = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    configured: aiService.isConfigured(),
    provider: aiService.provider,
    models: aiService.models,
  });
});

export const askTutor = asyncHandler(async (req, res) => {
  const { question, subject = 'General', persona = 'Tutor', conversationHistory = [] } = req.body;
  if (!question || !String(question).trim()) {
    throw new ApiError(400, 'Question or study topic is required.');
  }

  const answer = await aiService.askTutor({
    question: String(question).trim(),
    subject,
    persona,
    conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
  });

  res.json({
    success: true,
    answer,
    persona,
    subject,
    aiConfigured: aiService.isConfigured(),
  });
});

export const summarizeStudyNotes = asyncHandler(async (req, res) => {
  const { text, format = 'bullet_points' } = req.body;
  if (!text || String(text).trim().length < 20) {
    throw new ApiError(400, 'Please provide at least 20 characters of study notes to summarize.');
  }

  const summary = await aiService.summarizeNotes({
    text: String(text).trim(),
    format,
  });

  res.json({
    success: true,
    summary,
    format,
    aiConfigured: aiService.isConfigured(),
  });
});
