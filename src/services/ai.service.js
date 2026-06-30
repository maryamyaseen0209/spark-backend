import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';

const FREE_GROQ_MODELS = Object.freeze({
  fast: 'llama-3.3-70b-versatile',
  reasoning: 'llama-3.3-70b-versatile',
  explanation: 'gemma2-9b-it',
});

let groqClient;

function getGroqClient() {
  if (!env.ai.apiKey) return null;

  if (!groqClient) groqClient = new Groq({ apiKey: env.ai.apiKey });
  return groqClient;
}

async function complete({ messages, model = env.ai.defaultModel, temperature = 0.4, maxTokens = 1200 }) {
  const client = getGroqClient();
  if (!client) throw new ApiError(503, 'AI is not configured. Add GROQ_API_KEY in backend/.env and restart the backend.');

  let completion;
  try {
    completion = await client.chat.completions.create({ model, messages, temperature, max_tokens: maxTokens });
  } catch (error) {
    const message = error?.error?.message || error?.message || 'Groq AI request failed.';
    throw new ApiError(502, `AI provider error: ${message}`);
  }

  return completion.choices?.[0]?.message?.content?.trim() || '';
}

function fallbackQuizQuestions({ sourceText, totalQuestions = 10, difficulty = 'mixed' }) {
  const sentences = String(sourceText || '')
    .split(/[.!?]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 35)
    .slice(0, Math.max(Number(totalQuestions), 1));

  return Array.from({ length: Math.max(Number(totalQuestions), 1) }, (_, index) => {
    const sentence = sentences[index % Math.max(sentences.length, 1)] || 'the uploaded study material';
    const keyword = sentence.split(/\s+/).slice(0, 8).join(' ');
    return {
      text: `According to the uploaded document, what idea is best supported by: "${keyword}..."?`,
      difficulty: difficulty === 'mixed' ? 'medium' : difficulty,
      learningObjective: 'Recall and interpret the uploaded document.',
      explanation: 'This question was generated from the uploaded document while live AI is unavailable. Add GROQ_API_KEY for higher quality AI questions.',
      options: [
        { text: sentence.slice(0, 140), isCorrect: true },
        { text: 'A detail that is not supported by the uploaded document', isCorrect: false },
        { text: 'An unrelated classroom management statement', isCorrect: false },
        { text: 'A general opinion without document evidence', isCorrect: false },
      ],
    };
  });
}

function parseJsonObject(content) {
  const cleaned = String(content || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('AI response did not contain valid JSON.');
  return JSON.parse(cleaned.slice(first, last + 1));
}

function normalizeQuizQuestions(content) {
  const parsed = parseJsonObject(content);
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  return questions.map((item) => {
    const optionTexts = Array.isArray(item.options) ? item.options.map((option) => String(option?.text || option).trim()).filter(Boolean).slice(0, 4) : [];
    const correctText = String(item.correctAnswer || item.answer || '').trim();
    const correctIndex = Number.isInteger(item.correctOptionIndex) ? item.correctOptionIndex : optionTexts.findIndex((option) => option.toLowerCase() === correctText.toLowerCase());
    return {
      text: String(item.question || item.text || '').trim(),
      difficulty: ['easy', 'medium', 'hard'].includes(String(item.difficulty).toLowerCase()) ? String(item.difficulty).toLowerCase() : 'medium',
      learningObjective: String(item.learningObjective || '').trim(),
      explanation: String(item.explanation || 'Review the document section related to this question.').trim(),
      options: optionTexts.map((text, index) => ({ text, isCorrect: index === Math.max(correctIndex, 0) })),
    };
  }).filter((question) => question.text && question.options.length >= 2 && question.options.some((option) => option.isCorrect));
}

export const aiService = {
  provider: 'groq',
  models: FREE_GROQ_MODELS,
  isConfigured: () => Boolean(env.ai.apiKey),

  async generateAssignment({ topic, wordCount = 800, difficulty = 'Intermediate', references = false }) {
    const normalizedTopic = String(topic || '').trim();
    if (!normalizedTopic) throw new ApiError(400, 'Assignment topic is required.');
    return complete({
      model: env.ai.defaultModel,
      temperature: 0.55,
      maxTokens: Math.min(Math.max(Number(wordCount) * 2, 1600), 5000),
      messages: [
        { role: 'system', content: 'You are Study SparkAI, an expert academic assignment writer. Use Groq reasoning to write a relevant, topic-specific assignment answer. Do not write generic template text. Do not create quiz questions. Do not ask follow-up questions. Do not mention AI.' },
        { role: 'user', content: `Write a complete, relevant assignment answer on this exact topic: "${normalizedTopic}".

Requirements:
- Target length: about ${wordCount} words.
- Difficulty level: ${difficulty}.
- Start with a title that exactly matches the topic.
- Directly answer the topic from the first paragraph; do not give a generic study template.
- Include topic-specific facts, concepts, causes, effects, types, applications, examples, advantages, limitations, critical analysis, and conclusion where relevant.
- Use headings, but write the explanation in complete paragraphs.
- Add concrete examples that fit the topic, not generic examples.
- Keep the content polished and ready for a student to submit after review.
- Do not generate quiz questions.
- Do not say you cannot answer.
- Do not leave placeholders like "add example here".
${references ? '- Include a short references section with credible source types the student can verify.' : '- Do not include a references section unless needed.'}` },
      ],
    });
  },

  async generateQuizQuestions({ sourceText, totalQuestions = 10, difficulty = 'mixed', questionType = 'multiple-choice' }) {
    if (!this.isConfigured()) return fallbackQuizQuestions({ sourceText, totalQuestions, difficulty });
    const content = await complete({
      model: env.ai.reasoningModel,
      temperature: 0.3,
      maxTokens: 3500,
      messages: [
        { role: 'system', content: 'You are Study SparkAI, an expert educational quiz generator. Return only valid JSON.' },
        { role: 'user', content: `Generate ${totalQuestions} ${difficulty} ${questionType} questions from this uploaded document text. Each question must have exactly 4 options, one correct answer, difficulty, learningObjective, and explanation. Return this JSON shape only: {"questions":[{"question":"...","options":["A","B","C","D"],"correctAnswer":"A","difficulty":"medium","learningObjective":"...","explanation":"..."}]}.\n\nDocument text:\n${sourceText.slice(0, 60000)}` },
      ],
    });
    return normalizeQuizQuestions(content);
  },

  async explainAnswer({ question, correctAnswer, studentAnswer }) {
    return complete({
      model: env.ai.explanationModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Explain quiz mistakes kindly and clearly for a student.' },
        { role: 'user', content: `Question: ${question}\nStudent answer: ${studentAnswer}\nCorrect answer: ${correctAnswer}\nExplain why the correct answer is right.` },
      ],
    });
  },
};