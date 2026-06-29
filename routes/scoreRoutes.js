const express = require("express");
const { saveScore, getHistory } = require("../controllers/scoreController");
const { verifyFirebaseToken } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/save", verifyFirebaseToken, saveScore);
router.get("/history", verifyFirebaseToken, getHistory);

module.exports = router;
