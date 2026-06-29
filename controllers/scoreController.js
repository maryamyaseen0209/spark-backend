const { db } = require("../config/firebaseAdmin");

const memoryScores = [];

const saveScore = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { resultId, attemptId, score, totalQuestions, percentage, difficulty, category = "Custom", quizTitle = "AI Generated Quiz" } = req.body;
    const date = new Date().toISOString();

    const result = {
      userId,
      resultId,
      attemptId,
      quizTitle,
      category,
      score,
      totalQuestions,
      percentage,
      difficulty,
      date,
      createdAt: date,
    };

    if (db) {
      const docRef = await db.collection("scores").add(result);
      return res.status(201).json({ message: "Score saved", id: docRef.id, result });
    }

    memoryScores.push(result);
    res.status(201).json({ message: "Score saved in demo memory", result });
  } catch (error) {
    res.status(500).json({ message: "Failed to save score", error: error.message });
  }
};

const getHistory = async (req, res) => {
  try {
    const userId = req.user.uid;

    if (db) {
      const snapshot = await db
        .collection("scores")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(30)
        .get();

      const history = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json({ history });
    }

    const history = memoryScores.filter((item) => item.userId === userId).reverse();
    res.status(200).json({ history });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch history", error: error.message });
  }
};

module.exports = { saveScore, getHistory };
