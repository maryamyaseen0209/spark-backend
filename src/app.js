import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import assignmentRoutes from './routes/assignment.routes.js';
import adminRoutes from './routes/admin.routes.js';
import authRoutes from './routes/auth.routes.js';
import classroomRoutes from './routes/classroom.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import healthRoutes from './routes/health.routes.js';
import messageRoutes from './routes/message.routes.js';
import meetingRoutes from './routes/meeting.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import quizRoutes from './routes/quiz.routes.js';
import resourceRoutes from './routes/resource.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = env.nodeEnv !== 'production';
const localReadPaths = ['/api/auth/me', '/api/health', '/api/dashboard', '/api/classrooms', '/api/notifications', '/api/resources', '/api/meetings', '/api/admin'];
const localFeaturePaths = ['/api/assignments', '/api/classrooms', '/api/dashboard', '/api/messages', '/api/meetings', '/api/notifications', '/api/quizzes', '/api/resources'];

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://spark-frontend-inky-theta.vercel.app',
  'https://spark-frontend-gsp9dko4r-meowmeow123.vercel.app',
  env.clientUrl,
].filter(Boolean).map(url => url.endsWith('/') ? url.slice(0, -1) : url);

app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.nodeEnv === 'production' ? 300 : 5000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => isDevelopment && (
    localFeaturePaths.some((path) => req.path === path || req.path.startsWith(`${path}/`))
    || (req.method === 'GET' && localReadPaths.some((path) => req.path === path || req.path.startsWith(`${path}/`)))
  ),
  message: { success: false, message: 'Too many requests. Please wait a moment and try again.' },
}));


app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'Study SparkAI API',
    status: 'ok',
    phase: 1,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Study SparkAI API',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});


app.use('/api/health', healthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/resources', resourceRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
