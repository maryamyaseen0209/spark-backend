import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

const clean = (value) => (typeof value === 'string' ? value.trim() : value);
const bool = (value, fallback = false) => (value === undefined ? fallback : String(value).trim().toLowerCase() === 'true');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4009),
  apiUrl: clean(process.env.API_URL) || `http://localhost:${process.env.PORT || 4009}`,
  clientUrl: clean(process.env.CLIENT_URL) || 'http://localhost:5173',
  mongoUri: clean(process.env.MONGODB_URI) || 'mongodb://127.0.0.1:27017/study_sparkai',
  jwtAccessSecret: clean(process.env.JWT_ACCESS_SECRET) || 'dev-access-secret-change-me',
  jwtRefreshSecret: clean(process.env.JWT_REFRESH_SECRET) || 'dev-refresh-secret-change-me',
  jwtResetSecret: clean(process.env.JWT_RESET_SECRET) || 'dev-reset-secret-change-me',
  accessTokenTtl: clean(process.env.ACCESS_TOKEN_TTL) || '15m',
  refreshTokenTtl: clean(process.env.REFRESH_TOKEN_TTL) || '7d',
  passwordResetTtl: clean(process.env.PASSWORD_RESET_TTL) || '1h',
  cookieSecure: bool(process.env.COOKIE_SECURE),
  email: {
    host: clean(process.env.SMTP_HOST || process.env.SMTP_SERVER),
    port: Number(process.env.SMTP_PORT || 587),
    secure: bool(process.env.SMTP_SECURE),
    user: clean(process.env.SMTP_USER),
    pass: clean(process.env.SMTP_PASS),
    from: clean(process.env.SMTP_FROM) || 'Study SparkAI <no-reply@studysparkai.local>',
    enabled: Boolean(clean(process.env.SMTP_HOST || process.env.SMTP_SERVER)),
  },
  ai: {
    provider: 'groq',
    apiKey: clean(process.env.GROQ_API_KEY),
    defaultModel: clean(process.env.GROQ_MODEL) || 'llama-3.3-70b-versatile',
    reasoningModel: clean(process.env.GROQ_REASONING_MODEL) || 'llama-3.3-70b-versatile',
    explanationModel: clean(process.env.GROQ_EXPLANATION_MODEL) || 'gemma2-9b-it',
  },
  cloudinary: {
    cloudName: clean(process.env.CLOUDINARY_CLOUD_NAME),
    apiKey: clean(process.env.CLOUDINARY_API_KEY),
    apiSecret: clean(process.env.CLOUDINARY_API_SECRET),
    uploadFolder: clean(process.env.CLOUDINARY_UPLOAD_FOLDER) || 'study-sparkai/resources',
    enabled: Boolean(clean(process.env.CLOUDINARY_CLOUD_NAME) && clean(process.env.CLOUDINARY_API_KEY) && clean(process.env.CLOUDINARY_API_SECRET)),
  },
  redis: {
    url: clean(process.env.REDIS_URL),
    enabled: Boolean(clean(process.env.REDIS_URL)),
  },
  zoom: {
    accountId: clean(process.env.ZOOM_ACCOUNT_ID),
    clientId: clean(process.env.ZOOM_CLIENT_ID),
    clientSecret: clean(process.env.ZOOM_CLIENT_SECRET),
    hostUserId: clean(process.env.ZOOM_HOST_USER_ID) || 'me',
    timezone: clean(process.env.ZOOM_TIMEZONE) || 'Asia/Karachi',
    waitingRoom: bool(process.env.ZOOM_WAITING_ROOM, true),
    joinBeforeHost: bool(process.env.ZOOM_JOIN_BEFORE_HOST),
    muteUponEntry: bool(process.env.ZOOM_MUTE_UPON_ENTRY, true),
    autoRecording: clean(process.env.ZOOM_AUTO_RECORDING) || 'none',
    enabled: Boolean(clean(process.env.ZOOM_ACCOUNT_ID) && clean(process.env.ZOOM_CLIENT_ID) && clean(process.env.ZOOM_CLIENT_SECRET)),
  },
};
