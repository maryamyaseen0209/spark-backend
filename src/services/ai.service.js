import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';

const FREE_GROQ_MODELS = Object.freeze({
  fast: 'qwen/qwen3.8-27b',
  reasoning: 'openai/gpt-oss-120b',
  explanation: 'openai/gpt-oss-20b',
});

const CANDIDATE_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];

let groqClient = null;
let lastApiKey = null;

function getApiKey() {
  return (process.env.GROQ_API_KEY || env.ai.apiKey || '').trim().replace(/^["']|["']$/g, '');
}

function getGroqClient() {
  const currentKey = getApiKey();
  if (!currentKey) return null;
  if (!groqClient || lastApiKey !== currentKey) {
    groqClient = new Groq({ apiKey: currentKey });
    lastApiKey = currentKey;
  }
  return groqClient;
}

async function complete({ messages, model = env.ai.defaultModel, temperature = 0.4, maxTokens = 1500 }) {
  const client = getGroqClient();
  if (!client) throw new ApiError(503, 'AI is not configured. Add GROQ_API_KEY in backend/.env and restart the backend.');

  const modelsToTry = [model, ...CANDIDATE_MODELS.filter((m) => m !== model)];
  let lastError = null;

  for (const targetModel of modelsToTry) {
    try {
      const completion = await client.chat.completions.create({
        model: targetModel,
        messages,
        temperature,
        max_tokens: maxTokens,
      });
      return completion.choices?.[0]?.message?.content?.trim() || '';
    } catch (error) {
      lastError = error;
      const errStatus = error?.status || error?.statusCode;
      const errMsg = error?.error?.message || error?.message || '';
      // If model not found or decommissioned, fall through to next candidate model
      if (errStatus === 404 || errMsg.toLowerCase().includes('model') || errMsg.toLowerCase().includes('not found')) {
        continue;
      }
      throw new ApiError(errStatus || 502, `AI provider error: ${errMsg}`);
    }
  }

  const message = lastError?.error?.message || lastError?.message || 'Groq AI request failed.';
  throw new ApiError(502, `AI provider error: ${message}`);
}

function fallbackQuizQuestions({ sourceText, totalQuestions = 10, difficulty = 'mixed' }) {
  const sentences = String(sourceText || '')
    .split(/[.!?]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 30)
    .slice(0, Math.max(Number(totalQuestions), 1));

  return Array.from({ length: Math.max(Number(totalQuestions), 1) }, (_, index) => {
    const sentence = sentences[index % Math.max(sentences.length, 1)] || `Core learning concept ${index + 1}`;
    const keyword = sentence.split(/\s+/).slice(0, 7).join(' ');
    return {
      text: `Based on the key concept: "${keyword}...", which statement is accurate?`,
      difficulty: difficulty === 'mixed' ? (index % 3 === 0 ? 'hard' : index % 2 === 0 ? 'easy' : 'medium') : difficulty,
      learningObjective: 'Recall and demonstrate understanding of this study topic.',
      explanation: 'Review the fundamental concepts and definitions related to this subject.',
      options: [
        { text: sentence.slice(0, 140) || 'Primary accurate principle supported by evidence', isCorrect: true },
        { text: 'A misleading claim unsupported by standard theory', isCorrect: false },
        { text: 'An unrelated misconception commonly confused with this idea', isCorrect: false },
        { text: 'A general statement that lacks relevance to the problem', isCorrect: false },
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
  isConfigured: () => Boolean(getApiKey()),

  async generateAssignment({ topic, wordCount = 800, difficulty = 'Intermediate', references = false, documentText = '' }) {
    const normalizedTopic = String(topic || '').trim();
    if (!normalizedTopic) throw new ApiError(400, 'Assignment topic is required.');
    
    const docPrompt = documentText
      ? `\n\nStudy Material Context:\n${documentText.slice(0, 15000)}\n\nIncorporate relevant points from the study material above.`
      : '';

    return complete({
      model: env.ai.defaultModel,
      temperature: 0.55,
      maxTokens: Math.min(Math.max(Number(wordCount) * 2, 1600), 5000),
      messages: [
        {
          role: 'system',
          content: 'You are Study SparkAI, an expert academic assignment writer. Write a comprehensive, well-structured, topic-specific assignment. Do not write generic template text. Do not create quiz questions. Do not ask follow-up questions. Do not mention AI.',
        },
        {
          role: 'user',
          content: `Write a complete academic assignment answer on: "${normalizedTopic}".${docPrompt}

Requirements:
- Target length: approx ${wordCount} words.
- Academic level: ${difficulty}.
- Start with a clear title matching the topic.
- Structured with an Introduction, Key Body Sections with insightful explanations, concrete examples, and a Conclusion.
${references ? '- Include a References section with verified credible sources and academic citations.' : ''}`,
        },
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
        {
          role: 'user',
          content: `Generate ${totalQuestions} ${difficulty} ${questionType} questions from this uploaded document text. Each question must have exactly 4 options, one correct answer, difficulty, learningObjective, and explanation. Return this JSON shape only: {"questions":[{"question":"...","options":["A","B","C","D"],"correctAnswer":"A","difficulty":"medium","learningObjective":"...","explanation":"..."}]}.\n\nDocument text:\n${sourceText.slice(0, 60000)}`,
        },
      ],
    });
    return normalizeQuizQuestions(content);
  },

  async generateQuizFromTopic({ topic, subject = '', totalQuestions = 5, difficulty = 'mixed', questionType = 'multiple-choice' }) {
    if (!this.isConfigured()) {
      return fallbackQuizQuestions({ sourceText: topic, totalQuestions, difficulty });
    }
    const content = await complete({
      model: env.ai.reasoningModel,
      temperature: 0.35,
      maxTokens: 3500,
      messages: [
        { role: 'system', content: 'You are Study SparkAI, an expert educational quiz generator. Return only valid JSON.' },
        {
          role: 'user',
          content: `Generate ${totalQuestions} high-quality ${difficulty} ${questionType} quiz questions testing deep knowledge of "${topic}" (${subject ? `Subject: ${subject}` : 'General academic topic'}). Each question must have 4 distinct plausible options, one correct answer, difficulty (easy/medium/hard), learningObjective, and a clear pedagogical explanation. Return this JSON shape only: {"questions":[{"question":"...","options":["Option 1","Option 2","Option 3","Option 4"],"correctAnswer":"Option 1","difficulty":"medium","learningObjective":"...","explanation":"..."}]}.`,
        },
      ],
    });
    return normalizeQuizQuestions(content);
  },

  async askTutor({ question, subject = 'General', persona = 'Tutor', conversationHistory = [] }) {
    if (!this.isConfigured()) {
      return `### 💡 Study SparkAI Tutor (Dev Mode)\n\nTo unlock live answers powered by Groq LLaMA 3.3 70B, make sure \`GROQ_API_KEY\` is added in \`backend/.env\`.\n\n**Quick Study Tip on "${question}":**\n- Break this question down into core principles.\n- Create a short 3-point summary and test yourself with active recall!\n- Ask your teacher in classroom messages if you need detailed guidance.`;
    }

    const personaInstructions = {
      'Exam Coach': 'You are an intensive exam-prep coach. Focus on key exam questions, common student mistakes, mnemonic tricks, and high-yield scoring points.',
      'Concept Simplifier': 'You use the Feynman technique. Explain difficult scientific, mathematical, or technical concepts in simple, vivid language with real-world analogies so anyone can grasp them immediately.',
      'Tutor': 'You are a warm, encouraging, structured academic tutor. Provide clear step-by-step explanations, formulas where needed, and a quick practice checkpoint at the end.',
    }[persona] || 'You are an expert academic tutor.';

    const systemPrompt = `You are Study SparkAI Tutor, a world-class AI study companion for students and educators.
${personaInstructions}
Active Subject: ${subject}.

Formatting Guidelines:
- Use clean Markdown with bold headers, bullet points, and code blocks with syntax highlighting where applicable.
- For math or equations, format step-by-step clearly.
- At the end of helpful explanations, provide a 1-sentence "Quick Recall Question" or "Pro Study Tip".`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-8).map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: question },
    ];

    return complete({
      model: env.ai.defaultModel,
      temperature: 0.45,
      maxTokens: 1600,
      messages,
    });
  },

  async summarizeNotes({ text, format = 'bullet_points' }) {
    if (!this.isConfigured()) {
      return '### Study Notes Summary\n- Key Point 1: Review primary definitions.\n- Key Point 2: Focus on cause-and-effect relationships.\n- Key Point 3: Practice sample problems.\n\n*(Add GROQ_API_KEY for dynamic AI summaries)*';
    }

    const promptFormat = format === 'flashcards'
      ? 'Create 5 high-yield Q&A flashcards from the text below. Format each as "**Front (Q):** ...\n**Back (A):** ..."'
      : format === 'cheat_sheet'
      ? 'Create a compact 1-page quick revision cheat sheet highlighting core formulas, key terms, and summary facts.'
      : 'Provide a structured summary with: 1) Executive Summary, 2) Key Takeaways (bulleted), 3) Critical Terms & Concepts to remember.';

    return complete({
      model: env.ai.defaultModel,
      temperature: 0.35,
      maxTokens: 1500,
      messages: [
        { role: 'system', content: 'You are Study SparkAI, an expert in accelerated learning and study summarization.' },
        { role: 'user', content: `${promptFormat}\n\nStudy Material:\n${text.slice(0, 30000)}` },
      ],
    });
  },

  async explainAnswer({ question, correctAnswer, studentAnswer }) {
    return complete({
      model: env.ai.explanationModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Explain quiz mistakes kindly and clearly for a student.' },
        { role: 'user', content: `Question: ${question}\nStudent answer: ${studentAnswer}\nCorrect answer: ${correctAnswer}\nExplain why the correct answer is right and why the student answer is inaccurate.` },
      ],
    });
  },
};
