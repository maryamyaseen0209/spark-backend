const { admin } = require("../config/firebaseAdmin");

const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Authorization token missing" });
    }

    const token = authHeader.split("Bearer ")[1];

    if (!admin.apps.length) {
      req.user = { uid: "demo-user", email: "demo@example.com" };
      return next();
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid or expired token", error: error.message });
  }
};

module.exports = { verifyFirebaseToken };
