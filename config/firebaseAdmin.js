const admin = require("firebase-admin");
const fs = require("fs");
require("dotenv").config();

let app;

if (!admin.apps.length) {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const hasPlaceholderCredentials =
    !projectId ||
    !clientEmail ||
    !privateKey ||
    projectId === "your-project-id" ||
    clientEmail === "your-service-account-email" ||
    privateKey.includes("YOUR_PRIVATE_KEY");

  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    try {
      app = admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath)),
      });
    } catch (error) {
      console.warn(`Firebase Admin service account file is invalid. Auth middleware will run in demo mode. ${error.message}`);
      app = null;
    }
  } else if (hasPlaceholderCredentials) {
    console.warn("Firebase Admin credentials not found. Auth middleware will run in demo mode.");
    app = null;
  } else {
    try {
      app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } catch (error) {
      console.warn(`Firebase Admin credentials are invalid. Auth middleware will run in demo mode. ${error.message}`);
      app = null;
    }
  }
}

const db = admin.apps.length ? admin.firestore() : null;

module.exports = { admin, db };
