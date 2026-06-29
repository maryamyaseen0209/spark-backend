const { createQuizFromNotes, answerQuestionFromDocument, generateAssignmentAnswer } = require("../services/aiService");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const extractPdfText = async (buffer) => {
  if (typeof pdfParse === "function") {
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

  throw new Error("PDF parser is not available.");
};

const generateQuiz = async (req, res) => {
  try {
    const { notes, difficulty = "medium", questionCount = 10, category = "Computer Science" } = req.body;

    if (!notes || notes.trim().length < 30) {
      return res.status(400).json({ message: "Please paste at least 30 characters of notes." });
    }

    const count = Number(questionCount);
    if (!count || count < 1 || count > 20) {
      return res.status(400).json({ message: "Question count must be between 1 and 20." });
    }

    const studyPack = await createQuizFromNotes({ notes, difficulty, questionCount: count, category });

    res.status(200).json({
      message: "Quiz generated successfully",
      summary: studyPack.summary,
      keyPoints: studyPack.keyPoints,
      quiz: studyPack.quiz,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to generate quiz", error: error.message });
  }
};

const extractTextFromDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Please upload a document." });
    }

    const { originalname, mimetype, buffer } = req.file;
    const lowerName = originalname.toLowerCase();
    let text = "";

    if (mimetype === "application/pdf" || lowerName.endsWith(".pdf")) {
      text = await extractPdfText(buffer);
    } else if (
      mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lowerName.endsWith(".docx")
    ) {
      const parsed = await mammoth.extractRawText({ buffer });
      text = parsed.value;
    } else if (
      mimetype.startsWith("text/") ||
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".md") ||
      lowerName.endsWith(".csv")
    ) {
      text = buffer.toString("utf8");
    } else {
      return res.status(400).json({ message: "Unsupported file type. Upload PDF, DOCX, TXT, MD, or CSV." });
    }

    const cleanedText = text.replace(/\s+/g, " ").trim();
    if (!cleanedText || cleanedText.length < 30) {
      return res.status(400).json({ message: "Could not read enough text from this document." });
    }

    res.status(200).json({
      message: "Document text extracted successfully",
      fileName: originalname,
      text: cleanedText,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to read document text", error: error.message });
  }
};

const answerDocumentQuestion = async (req, res) => {
  try {
    const { documentText, question } = req.body;

    if (!documentText || documentText.trim().length < 30) {
      return res.status(400).json({ message: "Upload a document with readable text first." });
    }

    if (!question || question.trim().length < 3) {
      return res.status(400).json({ message: "Please enter a question." });
    }

    const answer = await answerQuestionFromDocument({ documentText, question });
    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ message: "Failed to answer question", error: error.message });
  }
};

const generateAssignment = async (req, res) => {
  try {
    const { topic, instructions = "", subject = "General" } = req.body;

    if (!topic || topic.trim().length < 5) {
      return res.status(400).json({ message: "Please enter an assignment topic or question." });
    }

    const answer = await generateAssignmentAnswer({ topic, instructions, subject });
    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ message: "Failed to generate assignment", error: error.message });
  }
};

module.exports = { generateQuiz, extractTextFromDocument, answerDocumentQuestion, generateAssignment };
