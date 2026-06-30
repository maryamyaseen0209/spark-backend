import Classroom from '../models/Classroom.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { emitNotification, emitToClassroom, emitToUser } from '../services/realtime.service.js';

const userFields = 'fullName email role avatarUrl';

function isMember(classroom, user) {
  return user.role === 'admin' || classroom.teacher.equals(user._id) || classroom.students.some((id) => id.equals(user._id));
}

async function assertCanReadThread(user, { userId, classroomId }) {
  if (classroomId) {
    const classroom = await Classroom.findById(classroomId);
    if (!classroom) throw new ApiError(404, 'Classroom not found');
    if (!isMember(classroom, user)) throw new ApiError(403, 'You cannot access this classroom thread');
    return { classroom };
  }
  if (!userId) throw new ApiError(400, 'Provide userId or classroomId');
  await assertCanMessageUser(user, userId);
  return {};
}

async function assertCanMessageUser(sender, receiverId) {
  if (sender.role === 'admin') return;
  const receiver = await User.findById(receiverId);
  if (!receiver || receiver.status !== 'active') throw new ApiError(404, 'Recipient not found');
  if (receiver.role === 'admin') throw new ApiError(403, 'Direct admin messaging is disabled here');

  const classroom = await Classroom.findOne(sender.role === 'teacher'
    ? { teacher: sender._id, students: receiverId }
    : { teacher: receiverId, students: sender._id });
  if (!classroom) throw new ApiError(403, 'You can only message teachers/students in your classrooms');
  if (sender.role === 'student' && classroom.communicationSettings?.studentMessagingEnabled === false) {
    throw new ApiError(403, 'Your teacher has disabled student messages for this classroom');
  }
}

export const listConversations = asyncHandler(async (req, res) => {
  const directMessages = await Message.find({ $or: [{ sender: req.user._id }, { receiver: req.user._id }] })
    .populate('sender', userFields)
    .populate('receiver', userFields)
    .sort({ createdAt: -1 })
    .limit(80);

  const conversations = [];
  const seen = new Set();
  for (const message of directMessages) {
    const other = String(message.sender._id) === String(req.user._id) ? message.receiver : message.sender;
    if (!other || seen.has(String(other._id))) continue;
    seen.add(String(other._id));
    const unreadCount = await Message.countDocuments({ sender: other._id, receiver: req.user._id, 'readBy.user': { $ne: req.user._id }, 'moderated.status': { $ne: 'hidden' } });
    conversations.push({ id: `direct:${other._id}`, type: 'direct', participant: other, lastMessage: message, unreadCount });
  }

  const classroomQuery = req.user.role === 'teacher' ? { teacher: req.user._id } : req.user.role === 'student' ? { students: req.user._id } : {};
  const classrooms = await Classroom.find(classroomQuery).select('name subject teacher students communicationSettings').sort({ createdAt: -1 }).limit(20);
  const classroomMessages = await Message.find({ classroom: { $in: classrooms.map((item) => item._id) } }).sort({ createdAt: -1 }).limit(80);
  const lastByClassroom = new Map(classroomMessages.map((message) => [String(message.classroom), message]));
  const unreadByClassroom = await Promise.all(classrooms.map(async (classroom) => [
    String(classroom._id),
    await Message.countDocuments({ classroom: classroom._id, sender: { $ne: req.user._id }, 'readBy.user': { $ne: req.user._id }, 'moderated.status': { $ne: 'hidden' } }),
  ]));
  const unreadMap = new Map(unreadByClassroom);
  classrooms.forEach((classroom) => conversations.push({ id: `classroom:${classroom._id}`, type: 'classroom', classroom, lastMessage: lastByClassroom.get(String(classroom._id)) || null, unreadCount: unreadMap.get(String(classroom._id)) || 0 }));

  res.json({ success: true, conversations });
});

export const listMessages = asyncHandler(async (req, res) => {
  const { userId, classroomId } = req.query;
  let query;
  if (classroomId) {
    await assertCanReadThread(req.user, { classroomId });
    query = { classroom: classroomId };
  } else if (userId) {
    await assertCanMessageUser(req.user, userId);
    query = { $or: [{ sender: req.user._id, receiver: userId }, { sender: userId, receiver: req.user._id }] };
  } else {
    throw new ApiError(400, 'Provide userId or classroomId');
  }

  if (req.user.role !== 'admin') query['moderated.status'] = { $ne: 'hidden' };
  const messages = await Message.find(query).populate('sender', userFields).populate('receiver', userFields).sort({ createdAt: 1 }).limit(100);
  res.json({ success: true, messages });
});

export const sendMessage = asyncHandler(async (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) throw new ApiError(400, 'Message content is required');
  const { receiver, classroom: classroomId, attachments = [], kind = 'message', priority = 'normal' } = req.body;
  if (!receiver && !classroomId) throw new ApiError(400, 'Choose a recipient or classroom');

  let recipients = [];
  if (classroomId) {
    const classroom = await Classroom.findById(classroomId);
    if (!classroom) throw new ApiError(404, 'Classroom not found');
    if (!isMember(classroom, req.user)) throw new ApiError(403, 'You cannot message this classroom');
    if (kind === 'announcement' && req.user.role !== 'admin' && !classroom.teacher.equals(req.user._id)) throw new ApiError(403, 'Only teachers can post announcements');
    if (kind !== 'announcement' && req.user.role === 'student' && (classroom.communicationSettings?.studentMessagingEnabled === false || classroom.communicationSettings.announcementsOnly)) {
      throw new ApiError(403, 'Student posting is disabled for this classroom');
    }
    recipients = [classroom.teacher, ...classroom.students].filter((id) => !id.equals(req.user._id));
  } else {
    await assertCanMessageUser(req.user, receiver);
    recipients = [receiver];
  }

  const message = await Message.create({ sender: req.user._id, receiver: classroomId ? undefined : receiver, classroom: classroomId, kind, priority, content, attachments, pinned: kind === 'announcement', readBy: [{ user: req.user._id, readAt: new Date() }] });
  const populated = await Message.findById(message._id).populate('sender', userFields).populate('receiver', userFields);
  const notifications = await Notification.insertMany(recipients.map((recipient) => ({
    recipient,
    actor: req.user._id,
    classroom: classroomId,
    messageRef: message._id,
    type: classroomId && kind === 'announcement' ? 'announcement_posted' : 'message_received',
    title: classroomId && kind === 'announcement' ? 'New classroom announcement' : classroomId ? 'New classroom message' : 'New direct message',
    message: `${req.user.fullName}: ${content.slice(0, 120)}`,
  })), { ordered: false }).catch(() => []);

  if (classroomId) emitToClassroom(req, classroomId, 'message:new', { message: populated });
  else emitToUser(req, receiver, 'message:new', { message: populated });
  emitToUser(req, req.user._id, 'message:new', { message: populated });
  notifications.forEach((notification) => emitNotification(req, notification));

  res.status(201).json({ success: true, message: populated });
});

export const listAnnouncements = asyncHandler(async (req, res) => {
  const { classroomId } = req.query;
  await assertCanReadThread(req.user, { classroomId });
  const announcements = await Message.find({ classroom: classroomId, kind: 'announcement', 'moderated.status': { $ne: 'hidden' } })
    .populate('sender', userFields)
    .sort({ pinned: -1, createdAt: -1 })
    .limit(50);
  res.json({ success: true, announcements });
});

export const moderateMessage = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') throw new ApiError(403, 'Only admins can moderate messages');
  const { status = 'flagged', reason = '' } = req.body;
  if (!['visible', 'flagged', 'hidden'].includes(status)) throw new ApiError(400, 'Invalid moderation status');
  const message = await Message.findById(req.params.id).populate('sender', userFields).populate('receiver', userFields);
  if (!message) throw new ApiError(404, 'Message not found');
  message.moderated = { status, reason, reviewedBy: req.user._id, reviewedAt: new Date() };
  await message.save();
  if (message.sender?._id) {
    const notification = await Notification.create({ recipient: message.sender._id, actor: req.user._id, classroom: message.classroom, messageRef: message._id, type: 'message_flagged', title: 'Message moderation update', message: `Your message was marked ${status}.${reason ? ` Reason: ${reason}` : ''}` });
    emitNotification(req, notification);
  }
  res.json({ success: true, message });
});

export const markThreadRead = asyncHandler(async (req, res) => {
  const { userId, classroomId } = req.body;
  await assertCanReadThread(req.user, { userId, classroomId });
  const query = classroomId ? { classroom: classroomId } : { sender: userId, receiver: req.user._id };
  await Message.updateMany({ ...query, 'readBy.user': { $ne: req.user._id } }, { $push: { readBy: { user: req.user._id, readAt: new Date() } } });
  const payload = { readerId: req.user._id, userId, classroomId, readAt: new Date() };
  if (classroomId) emitToClassroom(req, classroomId, 'message:read', payload);
  else if (userId) emitToUser(req, userId, 'message:read', payload);
  res.json({ success: true, message: 'Thread marked as read.' });
});