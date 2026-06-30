import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import app from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import Classroom from './models/Classroom.js';
import User from './models/User.js';
import { logger } from './utils/logger.js';

function canJoinClassroom(classroom, user) {
  return user.role === 'admin' || classroom.teacher.equals(user._id) || classroom.students.some((id) => id.equals(user._id));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.clientUrl, credentials: true },
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
    if (!token) return next(new Error('Authentication required'));
    const payload = jwt.verify(token, env.jwtAccessSecret);
    const user = await User.findById(payload.sub).select('-password');
    if (!user || user.status !== 'active') return next(new Error('Invalid account'));
    socket.user = user;
    return next();
  } catch (error) {
    return next(new Error('Invalid socket token'));
  }
});

io.on('connection', async (socket) => {
  const userId = String(socket.user._id);
  socket.join(`user:${userId}`);
  const classroomQuery = socket.user.role === 'teacher' ? { teacher: socket.user._id } : socket.user.role === 'student' ? { students: socket.user._id } : {};
  const classrooms = await Classroom.find(classroomQuery).select('_id');
  classrooms.forEach((classroom) => socket.join(`classroom:${classroom._id}`));
  logger.info('socket connected', { socketId: socket.id, userId });

  socket.on('classroom:join', async ({ classroomId } = {}, ack) => {
    try {
      const classroom = await Classroom.findById(classroomId).select('teacher students');
      if (!classroom || !canJoinClassroom(classroom, socket.user)) throw new Error('Classroom access denied');
      socket.join(`classroom:${classroomId}`);
      ack?.({ success: true });
    } catch (error) {
      ack?.({ success: false, message: error.message });
    }
  });

  socket.on('typing:start', ({ receiverId, classroomId } = {}) => {
    const payload = { userId, fullName: socket.user.fullName, receiverId, classroomId };
    if (classroomId) socket.to(`classroom:${classroomId}`).emit('typing:start', payload);
    else if (receiverId) socket.to(`user:${receiverId}`).emit('typing:start', payload);
  });

  socket.on('typing:stop', ({ receiverId, classroomId } = {}) => {
    const payload = { userId, fullName: socket.user.fullName, receiverId, classroomId };
    if (classroomId) socket.to(`classroom:${classroomId}`).emit('typing:stop', payload);
    else if (receiverId) socket.to(`user:${receiverId}`).emit('typing:stop', payload);
  });

  socket.on('disconnect', () => logger.info('socket disconnected', { socketId: socket.id, userId }));
});

app.set('io', io);

await connectDB();

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${env.port} is already in use. Stop the other backend process or set a different PORT in backend/.env.`);
    process.exit(1);
  }

  logger.error('Failed to start Study SparkAI API', { message: error.message, stack: error.stack });
  process.exit(1);
});

server.listen(env.port, () => {
  logger.info(`Study SparkAI API running on port ${env.port}`);
});
