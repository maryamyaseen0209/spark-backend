import Announcement from '../models/Announcement.js';
import AuditLog from '../models/AuditLog.js';
import Classroom from '../models/Classroom.js';
import Message from '../models/Message.js';
import Meeting from '../models/Meeting.js';
import ModerationCase from '../models/ModerationCase.js';
import Notification from '../models/Notification.js';
import Quiz from '../models/Quiz.js';
import QuizAttempt from '../models/QuizAttempt.js';
import Resource from '../models/Resource.js';
import SystemConfig from '../models/SystemConfig.js';
import User from '../models/User.js';
import { writeAuditLog } from '../services/audit.service.js';
import { emitNotification } from '../services/realtime.service.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const audienceRoleMap = { students: 'student', teachers: 'teacher', admins: 'admin' };

async function notifyAnnouncementAudience(req, announcement) {
  if (announcement.status !== 'published') return 0;
  const role = audienceRoleMap[announcement.audience];
  const userQuery = { status: 'active' };
  if (role) userQuery.role = role;

  const recipients = await User.find(userQuery).select('_id').lean();
  if (!recipients.length) return 0;

  const notifications = await Notification.insertMany(recipients.map((recipient) => ({
    recipient: recipient._id,
    actor: req.user._id,
    type: 'announcement_posted',
    title: announcement.title,
    message: announcement.body.slice(0, 500),
  })));

  notifications.forEach((notification) => emitNotification(req, notification));
  return notifications.length;
}

export const getAdminOverview = asyncHandler(async (req, res) => {
  const [users, classrooms, meetings, attempts, quizzes, resources, messages, notifications, moderationOpen] = await Promise.all([
    User.countDocuments(), Classroom.countDocuments(), Meeting.countDocuments(), QuizAttempt.countDocuments(), Quiz.countDocuments(), Resource.countDocuments(), Message.countDocuments(), Notification.countDocuments(), ModerationCase.countDocuments({ status: { $in: ['open', 'reviewing'] } }),
  ]);
  res.json({ success: true, overview: { users, classrooms, meetings, attempts, quizzes, resources, messages, notifications, moderationOpen } });
});

export const listUsers = asyncHandler(async (req, res) => {
  const { role, status, search = '', page = 1, limit = 25 } = req.query;
  const query = {};
  if (role) query.role = role;
  if (status) query.status = status;
  if (search) query.$or = [
    { fullName: { $regex: search, $options: 'i' } },
    { email: { $regex: search, $options: 'i' } },
    { institution: { $regex: search, $options: 'i' } },
  ];
  const safeLimit = Math.min(Number(limit) || 25, 100);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;
  const [users, total] = await Promise.all([
    User.find(query).select('-password -sessions').sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    User.countDocuments(query),
  ]);
  res.json({ success: true, users, pagination: { total, page: Number(page) || 1, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 } });
});

export const updateUserAdmin = asyncHandler(async (req, res) => {
  const allowed = ['role', 'status', 'emailVerified'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (updates.role && !['student', 'teacher', 'admin'].includes(updates.role)) throw new ApiError(400, 'Invalid role.');
  if (updates.status && !['active', 'suspended', 'pending'].includes(updates.status)) throw new ApiError(400, 'Invalid status.');
  const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password -sessions');
  if (!user) throw new ApiError(404, 'User not found.');
  await writeAuditLog({ req, action: 'admin.user.updated', entityType: 'User', entityId: user._id, summary: `Updated ${user.email}`, metadata: updates });
  res.json({ success: true, user });
});

export const listAnnouncements = asyncHandler(async (req, res) => {
  const announcements = await Announcement.find().populate('createdBy', 'fullName email').sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, announcements });
});

export const createAnnouncement = asyncHandler(async (req, res) => {
  const { title, body, audience = 'all', status = 'published' } = req.body;
  if (!title || !body) throw new ApiError(400, 'Title and body are required.');
  const announcement = await Announcement.create({ title, body, audience, status, createdBy: req.user._id, publishedAt: status === 'published' ? new Date() : null });
  const deliveredCount = await notifyAnnouncementAudience(req, announcement);
  await writeAuditLog({ req, action: 'admin.announcement.created', entityType: 'Announcement', entityId: announcement._id, summary: `Created announcement ${title}` });
  res.status(201).json({ success: true, announcement, deliveredCount });
});

export const updateAnnouncement = asyncHandler(async (req, res) => {
  const allowed = ['title', 'body', 'audience', 'status'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (updates.status === 'published') updates.publishedAt = new Date();
  const announcement = await Announcement.findByIdAndUpdate(req.params.id, updates, { new: true });
  if (!announcement) throw new ApiError(404, 'Announcement not found.');
  const deliveredCount = updates.status === 'published' ? await notifyAnnouncementAudience(req, announcement) : 0;
  await writeAuditLog({ req, action: 'admin.announcement.updated', entityType: 'Announcement', entityId: announcement._id, summary: `Updated announcement ${announcement.title}` });
  res.json({ success: true, announcement, deliveredCount });
});

export const deleteAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.findByIdAndDelete(req.params.id);
  if (!announcement) throw new ApiError(404, 'Announcement not found.');
  await writeAuditLog({ req, action: 'admin.announcement.deleted', entityType: 'Announcement', entityId: announcement._id, summary: `Deleted announcement ${announcement.title}` });
  res.json({ success: true });
});

export const listAuditLogs = asyncHandler(async (req, res) => {
  const logs = await AuditLog.find().populate('actor', 'fullName email role').sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, logs });
});

export const listModerationCases = asyncHandler(async (req, res) => {
  const cases = await ModerationCase.find().populate('reporter targetUser assignedTo', 'fullName email role').sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, cases });
});

export const createModerationCase = asyncHandler(async (req, res) => {
  const { targetUser, reason, details = '' } = req.body;
  if (!reason) throw new ApiError(400, 'Reason is required.');
  const item = await ModerationCase.create({ reporter: req.user._id, targetUser, reason, details });
  await writeAuditLog({ req, action: 'moderation.created', entityType: 'ModerationCase', entityId: item._id, summary: `Opened moderation case: ${reason}` });
  res.status(201).json({ success: true, case: item });
});

export const updateModerationCase = asyncHandler(async (req, res) => {
  const item = await ModerationCase.findByIdAndUpdate(req.params.id, { ...req.body, assignedTo: req.body.assignedTo || req.user._id }, { new: true });
  if (!item) throw new ApiError(404, 'Moderation case not found.');
  await writeAuditLog({ req, action: 'moderation.updated', entityType: 'ModerationCase', entityId: item._id, summary: `Updated moderation case ${item._id}` });
  res.json({ success: true, case: item });
});

export const listSystemConfig = asyncHandler(async (req, res) => {
  const config = await SystemConfig.find().populate('updatedBy', 'fullName email').sort({ key: 1 });
  res.json({ success: true, config });
});

export const upsertSystemConfig = asyncHandler(async (req, res) => {
  const { key, value, description = '' } = req.body;
  if (!key) throw new ApiError(400, 'Config key is required.');
  const config = await SystemConfig.findOneAndUpdate({ key }, { value, description, updatedBy: req.user._id }, { new: true, upsert: true });
  await writeAuditLog({ req, action: 'admin.config.updated', entityType: 'SystemConfig', entityId: config._id, summary: `Updated config ${key}` });
  res.json({ success: true, config });
});

export const getPermissions = asyncHandler(async (req, res) => {
  res.json({ success: true, permissions: {
    student: ['dashboard:read', 'classroom:join', 'quiz:attempt', 'message:send'],
    teacher: ['classroom:manage', 'quiz:publish', 'meeting:schedule', 'analytics:read'],
    admin: ['users:manage', 'moderation:manage', 'audit:read', 'settings:manage', 'analytics:read'],
  } });
});

export const getPlatformAnalytics = asyncHandler(async (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const [roleBreakdown, statusBreakdown, quizTrend, newestUsers] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    QuizAttempt.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, attempts: { $sum: 1 }, averageScore: { $avg: '$score' } } },
      { $sort: { _id: 1 } },
    ]),
    User.find().select('fullName email role status createdAt').sort({ createdAt: -1 }).limit(8),
  ]);
  res.json({
    success: true,
    analytics: {
      roleBreakdown: Object.fromEntries(roleBreakdown.map((item) => [item._id, item.count])),
      statusBreakdown: Object.fromEntries(statusBreakdown.map((item) => [item._id, item.count])),
      quizTrend: quizTrend.map((item) => ({ date: item._id, attempts: item.attempts, averageScore: Math.round(item.averageScore || 0) })),
      newestUsers,
    },
  });
});