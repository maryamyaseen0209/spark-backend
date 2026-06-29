const express = require("express");
const multer = require("multer");
const { generateQuiz, extractTextFromDocument, answerDocumentQuestion, generateAssignment } = require("../controllers/quizController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.post("/generate", generateQuiz);
router.post("/extract-text", upload.single("document"), extractTextFromDocument);
router.post("/ask-document", answerDocumentQuestion);
router.post("/assignment", generateAssignment);

module.exports = router;
