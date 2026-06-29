const axios = require("axios");

const STOP_WORDS = new Set([
  "what", "why", "how", "when", "where", "who", "which", "is", "are", "am", "the", "a", "an", "of", "to", "in", "on", "for", "from", "and", "or", "with", "this", "that", "it", "does", "do", "did", "be", "about", "explain", "define"
]);

const getKeywords = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

const createExtractiveDocumentAnswer = ({ documentText, question }) => {
  const keywords = getKeywords(question);
  const sentences = documentText
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => sentence.length > 35)
    .filter((sentence) => !/sample pdf|quiz generation|level intermediate|practice idea|-- \d+ of \d+ --|biology test notes|plant cells vs animal cells/i.test(sentence));

  const scoredSentences = sentences
    .map((sentence, index) => {
      const normalized = sentence.toLowerCase();
      const score = keywords.reduce((sum, keyword) => sum + (normalized.includes(keyword) ? 1 : 0), 0);
      return { sentence, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index);

  const selected = scoredSentences.length ? scoredSentences.map((item) => item.sentence) : sentences.slice(0, 3);

  if (!selected.length) {
    return "I could not find readable text in the uploaded document. Please upload a clearer PDF or paste the text manually.";
  }

  const answer = selected[0];
  const details = selected.slice(1);
  const explanation = details.length
    ? details.join(" ")
    : "This is the most relevant information found in the uploaded document for your question.";

  return `Answer: ${answer}\n\nDetailed explanation: ${explanation}`;
};

const prepareNotesForQuiz = (notes) => {
  const cleaned = notes.replace(/\s+/g, " ").trim();
  const maxChars = 60000;

  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  const start = cleaned.slice(0, 30000);
  const middleStart = Math.max(Math.floor(cleaned.length / 2) - 15000, 0);
  const middle = cleaned.slice(middleStart, middleStart + 30000);
  return `${start}\n\n[Middle section from a large document]\n\n${middle}`;
};

const generateGeminiText = async (prompt, temperature = 0.4) => {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature
      }
    },
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );

  const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("Gemini returned an empty response");
  }

  return content.trim();
};

const buildPrompt = ({ notes, difficulty, questionCount, category }) => `
You are an expert teacher and exam paper creator.

Create a study pack from the notes below.

Requirements:
- Difficulty level: ${difficulty}
- Subject/category: ${category}
- Create ${questionCount} high-quality multiple choice questions.
- Each question must have exactly 4 options.
- Only one option must be correct.
- Avoid repeated questions.
- Questions should test understanding, not only memorization.
- Include a short explanation for every correct answer.
- Also include a short topic summary and 3 to 6 important key points.
- Return only valid JSON.
- Do not include markdown.

JSON format:
{
  "summary": "Short summary here",
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "quiz": [
    {
      "question": "Question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Correct option text",
      "explanation": "Why this answer is correct"
    }
  ]
}

Notes:
${prepareNotesForQuiz(notes)}
`;

const splitSentences = (text) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|(?=\d+\.\s+[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 45)
    .filter((sentence) => !/sample pdf|quiz generation|level intermediate|practice idea|-- \d+ of \d+ --/i.test(sentence));

const getImportantTerms = (text) => {
  const words = getKeywords(text);
  const frequency = words.reduce((map, word) => {
    map[word] = (map[word] || 0) + 1;
    return map;
  }, {});

  return Object.entries(frequency)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([word]) => word)
    .filter((word, index, list) => list.indexOf(word) === index)
    .slice(0, 20);
};

const titleCase = (word) => word.charAt(0).toUpperCase() + word.slice(1);

const shortenOption = (text) => {
  if (text.length <= 160) return text;
  return `${text.slice(0, 157).trim()}...`;
};

const createLocalStudyPack = (notes, questionCount, difficulty, category) => {
  const sentences = splitSentences(notes);
  const importantTerms = getImportantTerms(notes);
  const usableSentences = sentences.length ? sentences : [notes.replace(/\s+/g, " ").trim()];
  const fallbackTerms = ["concept", "process", "function", "structure", "result"];
  const terms = importantTerms.length ? importantTerms : fallbackTerms;

  const questionTemplates = [
    (sentence, term) => ({
      question: `According to the notes, what is related to ${titleCase(term)}?`,
      correctAnswer: sentence,
    }),
    (sentence, term) => ({
      question: `Which statement best explains ${titleCase(term)} from the notes?`,
      correctAnswer: sentence,
    }),
    (sentence, term) => ({
      question: `What should a student remember about ${titleCase(term)}?`,
      correctAnswer: sentence,
    }),
  ];

  const distractors = [
    "It is not mentioned in the uploaded notes.",
    "It is unrelated to the topic described in the document.",
    "It only refers to the title and has no function.",
    "It always happens without any conditions or parts.",
    "It is described as a decorative feature only.",
    "It has the opposite role from the one explained in the notes.",
  ];

  const output = [];
  for (let i = 0; i < questionCount; i++) {
    const sentence = usableSentences[i % usableSentences.length];
    const term = terms[i % terms.length];
    const template = questionTemplates[i % questionTemplates.length](sentence, term);
    const wrongOptions = distractors
      .filter((option) => option !== template.correctAnswer)
      .slice(i % 3, (i % 3) + 3);
    const options = [shortenOption(template.correctAnswer), ...wrongOptions].slice(0, 4);

    while (options.length < 4) {
      options.push(distractors[options.length]);
    }

    output.push({
      question: `${i + 1}. ${template.question}`,
      options,
      correctAnswer: shortenOption(template.correctAnswer),
      explanation: `This answer is taken from the uploaded notes: ${sentence}`,
    });
  }

  return {
    summary: `${category} notes were converted into a ${difficulty} quiz using the uploaded text. The questions are based on the main terms and statements found in the document.`,
    keyPoints: usableSentences.slice(0, 5),
    quiz: output
  };
};

const parseQuizJson = (content) => {
  const cleaned = content
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed)) {
    return {
      summary: "Review the notes and answer the generated MCQs.",
      keyPoints: [],
      quiz: parsed
    };
  }

  return {
    summary: parsed.summary || "Review the notes and answer the generated MCQs.",
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    quiz: Array.isArray(parsed.quiz) ? parsed.quiz : []
  };
};

const createQuizWithOpenAI = async (prompt) => {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert educational quiz generator." },
        { role: "user", content: prompt }
      ],
      temperature: 0.4
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return parseQuizJson(response.data.choices[0].message.content);
};

const createQuizWithGemini = async (prompt) => {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json"
      }
    },
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );

  const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("Gemini returned an empty response");
  }

  return parseQuizJson(content);
};

const answerQuestionFromDocument = async ({ documentText, question }) => {
  const prompt = `
You are a helpful study assistant. Answer the student's question using only the document text below.

Rules:
- If the answer is not in the document, say that the document does not contain enough information.
- Keep the answer clear and student-friendly.
- Include a short "From the document" explanation.

Question:
${question}

Document:
${documentText}
`;

  if (!process.env.GEMINI_API_KEY) {
    return createExtractiveDocumentAnswer({ documentText, question });
  }

  try {
    return await generateGeminiText(prompt, 0.3);
  } catch (error) {
    const apiMessage = error.response?.data?.error?.message || error.message;
    console.warn(`Document Q&A failed. Using extractive fallback answer. ${apiMessage}`);
    return createExtractiveDocumentAnswer({ documentText, question });
  }
};

const generateAssignmentAnswer = async ({ topic, instructions = "", subject = "General" }) => {
  const cleanTopic = topic
    .replace(/generate\s+(an?\s+)?assignment\s+(on|about)?/gi, "")
    .replace(/write\s+(an?\s+)?assignment\s+(on|about)?/gi, "")
    .trim() || topic;

  const prompt = `
You are an academic writing assistant for students.

Generate a detailed, polished assignment answer.

Subject: ${subject}
Topic: ${cleanTopic}
Student request: ${topic}
Instructions: ${instructions || "Use a detailed student-friendly format."}

Requirements:
- Start with a clear title.
- First give a proper definition.
- Then explain the working/function/process.
- Then provide at least one example.
- Then give a detailed explanation with important points.
- End with a conclusion.
- Keep the tone educational and original.
- Use clear headings exactly like:
  1. Definition
  2. Working / Function
  3. Example
  4. Detailed Explanation
  5. Conclusion
- Write enough detail for a school/college assignment.
`;

  const fallbackAnswer = `# Assignment: ${cleanTopic}

## 1. Definition
${cleanTopic} is an important topic in ${subject}. It refers to the main concept, process, or idea that helps students understand how something works and why it is useful. In simple words, ${cleanTopic} explains the basic meaning and importance of the topic in a clear educational way.

## 2. Working / Function
The working or function of ${cleanTopic} depends on its role in the subject. It shows how the concept operates step by step and how different parts are connected. To understand it properly, students should focus on:

- what the concept means,
- how it starts,
- what process or function takes place,
- what result is produced,
- and why that result is important.

For example, if the topic is photosynthesis, the process starts when green plants absorb sunlight using chlorophyll. The plant takes in carbon dioxide from the air and water from the soil. With the help of sunlight, these substances are converted into glucose, which gives energy to the plant, and oxygen, which is released into the air.

## 3. Example
A simple example of ${cleanTopic} can be seen in daily life. Green plants prepare their own food through photosynthesis. When sunlight falls on leaves, chlorophyll captures light energy. The plant uses this energy to make glucose from carbon dioxide and water. This glucose is used by the plant for growth, while oxygen is released for living organisms.

## 4. Detailed Explanation
${cleanTopic} is important because it helps explain a major idea in ${subject}. It connects theory with practical understanding. A detailed explanation should include the main parts of the topic, their purpose, and the final result.

In the case of photosynthesis, leaves play the main role because they contain chlorophyll. Chlorophyll is the green pigment that absorbs sunlight. Carbon dioxide enters the leaves through small openings called stomata, while water is absorbed by roots and transported to the leaves. Sunlight provides energy for the chemical reaction. As a result, glucose is produced as food for the plant, and oxygen is released into the atmosphere.

This process is important for life on Earth. Plants are producers because they make their own food. Animals and humans depend on plants directly or indirectly for food and oxygen. Therefore, understanding ${cleanTopic} helps students understand the relationship between plants, animals, energy, and the environment.

Important points:
- It explains how a process or concept works.
- It helps students understand cause and effect.
- It connects textbook knowledge with real-life examples.
- It improves exam preparation because the answer is structured.

## 5. Conclusion
In conclusion, ${cleanTopic} is an important topic in ${subject}. It should be understood through its definition, working, examples, and detailed explanation. A clear understanding of this topic helps students write better answers and understand the subject more deeply.`;

  if (!process.env.GEMINI_API_KEY) {
    return fallbackAnswer;
  }

  try {
    return await generateGeminiText(prompt, 0.5);
  } catch (error) {
    const apiMessage = error.response?.data?.error?.message || error.message;
    console.warn(`Assignment generation failed. Using fallback answer. ${apiMessage}`);
    return fallbackAnswer;
  }
};

const createQuizFromNotes = async ({ notes, difficulty, questionCount, category = "Computer Science" }) => {
  const prompt = buildPrompt({ notes, difficulty, questionCount, category });
  const provider = process.env.AI_PROVIDER || "gemini";

  if (provider === "gemini") {
    if (!process.env.GEMINI_API_KEY) {
      return createLocalStudyPack(notes, questionCount, difficulty, category);
    }

    try {
      return await createQuizWithGemini(prompt);
    } catch (error) {
      const apiMessage = error.response?.data?.error?.message || error.message;
      console.warn(`Gemini quiz generation failed. Using local text-based quiz instead. ${apiMessage}`);
      return createLocalStudyPack(notes, questionCount, difficulty, category);
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return createLocalStudyPack(notes, questionCount, difficulty, category);
  }

  return createQuizWithOpenAI(prompt);
};

module.exports = { createQuizFromNotes, answerQuestionFromDocument, generateAssignmentAnswer };
