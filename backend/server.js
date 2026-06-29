const express = require("express");
const cors = require("cors");
require("dotenv").config();

const quizRoutes = require("./routes/quizRoutes");
const scoreRoutes = require("./routes/scoreRoutes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/", (req, res) => {
  res.json({ message: "StudySpark AI Backend Running" });
});

app.use("/api/quiz", quizRoutes);
app.use("/api/score", scoreRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
