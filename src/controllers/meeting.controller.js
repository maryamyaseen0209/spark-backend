import crypto from 'node:crypto';
import Classroom from '../models/Classroom.js';
import Meeting from '../models/Meeting.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { cancelZoomMeeting, createZoomMeeting, inviteZoomUser } from '../services/zoom.service.js';
import { writeAuditLog } from '../services/audit.service.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

async function getAccessibleClassrooms(user) {
  if (user.role === 'teacher') return Classroom.find({ teacher: user._id, status: 'active' }).select('_id name subject students teacher');
  if (user.role === 'student') return Classroom.find({ students: user._id, status: 'active' }).select('_id name subject students teacher');
  return Classroom.find({ status: 'active' }).select('_id name subject students teacher');
}

function canStartMeeting(user, meeting) {
  return String(meeting.host?._id || meeting.host) === String(user._id);
}

function canCancelMeeting(user, meeting) {
  return user.role === 'admin' || String(meeting.host?._id || meeting.host) === String(user._id);
}

function canLaunchAsZoomHost(user, meeting) {
  if (meeting.provider !== 'zoom') return canStartMeeting(user, meeting);
  return canStartMeeting(user, meeting);
}

function serializeMeetingForUser(meeting, user) {
  const item = typeof meeting.toObject === 'function' ? meeting.toObject() : meeting;
  const canStart = canStartMeeting(user, item);
  const canLaunchAsHost = canLaunchAsZoomHost(user, item);
  const legalHostId = item.legalHost?._id || item.legalHost || item.host?._id || item.host;
  const legalHost = item.legalHost || item.host;
  const startUrl = canLaunchAsHost ? item.startUrl : undefined;
  return {
    ...item,
    legalHost,
    legalHostId,
    appHost: legalHost,
    isLegalHost: String(legalHostId) === String(user._id),
    startUrl,
    launchUrl: canLaunchAsHost ? item.startUrl || item.joinUrl : item.joinUrl,
    launchRole: canLaunchAsHost ? 'host' : 'participant',
    canStart,
    canLaunchAsHost,
    canCancel: canCancelMeeting(user, item),
  };
}

function serializeZoomConnection(user) {
  const serverConfigured = env.zoom.enabled;
  return {
    configured: serverConfigured,
    connected: serverConfigured,
    serverConfigured,
    mode: serverConfigured ? 'server_to_server' : 'not_configured',
    hostUserId: env.zoom.hostUserId,
    message: serverConfigured
      ? 'Zoom Server-to-Server OAuth is configured. Teachers are the legal app hosts; Zoom meetings are created by the configured Zoom account, with eligible teachers assigned as alternative hosts when Zoom allows it.'
      : 'Zoom Server-to-Server OAuth is not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET from your Zoom Server-to-Server OAuth app.',
  };
}

export const listMeetings = asyncHandler(async (req, res) => {
  const classrooms = await getAccessibleClassrooms(req.user);
  const classroomIds = classrooms.map((item) => item._id);
  const meetings = await Meeting.find({ classroom: { $in: classroomIds } })
    .populate('classroom', 'name subject')
    .populate('host', 'fullName email role')
    .sort({ startsAt: 1 })
    .limit(100);
  res.json({ success: true, meetings: meetings.map((meeting) => serializeMeetingForUser(meeting, req.user)), classrooms });
});

export const createMeeting = asyncHandler(async (req, res) => {
  if (req.user.role !== 'teacher') throw new ApiError(403, 'Only teachers can schedule meetings.');
  const { title, description = '', classroomId, startsAt, durationMinutes = 45, provider = 'zoom' } = req.body;
  if (!title || !classroomId || !startsAt) throw new ApiError(400, 'Title, classroom, and start time are required.');
  const classroomQuery = { _id: classroomId, teacher: req.user._id };
  const classroom = await Classroom.findOne(classroomQuery).populate('teacher', 'email fullName role');
  if (!classroom) throw new ApiError(404, 'Classroom not found or not owned by you.');
  const startDate = new Date(startsAt);
  if (Number.isNaN(startDate.getTime())) throw new ApiError(400, 'Invalid meeting start time.');
  const teacherId = req.user._id;
  const teacher = await User.findById(teacherId).select('+zoomOAuth.accessToken +zoomOAuth.refreshToken');
  if (provider === 'zoom' && !env.zoom.enabled) throw new ApiError(400, 'Zoom is not configured. Add Zoom Server-to-Server OAuth credentials.');
  let meetingConfig;
  if (provider === 'zoom') {
    meetingConfig = await createZoomMeeting({ title, startsAt: startDate, durationMinutes, hostUserId: env.zoom.hostUserId, alternativeHostEmail: teacher.email });
    if (meetingConfig.providerStatus !== 'configured') {
      throw new ApiError(502, meetingConfig.message || 'Zoom could not create this meeting. Check the server Zoom configuration.');
    }
  } else if (provider === 'jitsi') {
    const roomName = `StudySparkAI-${crypto.randomUUID()}`;
    const meetUrl = `https://meet.jit.si/${roomName}`;
    const teacherUrl = `${meetUrl}#userInfo.displayName=${encodeURIComponent(teacher.fullName || 'Teacher')}&config.prejoinPageEnabled=false`;
    const studentUrl = `${meetUrl}#config.startWithAudioMuted=true&config.startWithVideoMuted=true`;
    meetingConfig = {
      providerStatus: 'configured',
      joinUrl: studentUrl,
      startUrl: teacherUrl,
      providerMeetingId: roomName,
      message: 'Jitsi Meet room ready.',
      hostEmail: teacher.email,
      password: '',
      startTime: startDate.toISOString()
    };
  } else {
    meetingConfig = { providerStatus: 'manual', joinUrl: null, startUrl: null, providerMeetingId: null, message: '', hostEmail: null, password: '', startTime: null };
  }
  const meeting = await Meeting.create({
    title,
    description,
    classroom: classroom._id,
    host: teacherId,
    startsAt: startDate,
    durationMinutes,
    provider,
    attendees: classroom.students,
    joinUrl: meetingConfig.joinUrl,
    startUrl: meetingConfig.startUrl,
    providerMeetingId: meetingConfig.providerMeetingId,
    providerStatus: meetingConfig.providerStatus,
    providerMetadata: {
      message: meetingConfig.message,
      password: meetingConfig.password,
      hostEmail: meetingConfig.hostEmail,
      requestedHostEmail: teacher.email,
      teacherHostEmail: teacher.email,
      legalHostUserId: String(teacherId),
      legalHostRole: 'teacher',
      startTime: meetingConfig.startTime,
      authMode: provider === 'zoom' ? 'server_to_server' : 'jitsi_free',
      alternativeHosts: meetingConfig.alternativeHosts,
      alternativeHostWarning: meetingConfig.alternativeHostWarning,
    },
  });
  await Notification.insertMany(classroom.students.map((recipient) => ({
    recipient,
    actor: req.user._id,
    classroom: classroom._id,
    type: 'meeting_scheduled',
    title: `Meeting scheduled: ${title}`,
    message: `${classroom.name} meeting starts ${startDate.toLocaleString()}.`,
  })));
  await writeAuditLog({ req, action: 'meeting.created', entityType: 'Meeting', entityId: meeting._id, summary: `Scheduled meeting ${title}` });
  res.status(201).json({ success: true, meeting: serializeMeetingForUser(meeting, req.user), configurationMessage: meetingConfig.message });
});

export const getZoomConnectionStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, zoom: serializeZoomConnection(req.user) });
});

export const inviteTeacherToZoom = asyncHandler(async (req, res) => {
  if (req.user.role !== 'teacher') throw new ApiError(403, 'Only teachers can request Zoom invites.');
  const user = await User.findById(req.user._id);
  const result = await inviteZoomUser(user.email);
  res.json(result);
});

export const startZoomConnect = asyncHandler(async (req, res) => {
  throw new ApiError(410, 'Teacher Zoom connect is disabled. This app uses Zoom Server-to-Server OAuth credentials from the backend .env file.');
});

export const disconnectZoom = asyncHandler(async (req, res) => {
  res.json({ success: true, zoom: serializeZoomConnection(req.user) });
});

export const cancelMeeting = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findById(req.params.id).populate('classroom', 'teacher students name').populate('host', 'fullName email role');
  if (!meeting) throw new ApiError(404, 'Meeting not found.');
  const canCancel = req.user.role === 'admin' || String(meeting.host?._id || meeting.host) === String(req.user._id) || String(meeting.classroom.teacher) === String(req.user._id);
  if (!canCancel) throw new ApiError(403, 'You cannot cancel this meeting.');
  if (meeting.provider === 'zoom' && meeting.providerMeetingId && meeting.providerStatus === 'configured') {
    try {
      const cancellation = await cancelZoomMeeting(meeting.providerMeetingId);
      meeting.providerStatus = cancellation.providerStatus || meeting.providerStatus;
      meeting.providerMetadata = { ...(meeting.providerMetadata || {}), cancellationMessage: cancellation.message, cancelledAt: new Date() };
    } catch (error) {
      console.warn('Zoom cancellation failed; cancelling meeting in app only:', error.message);
      meeting.providerStatus = 'failed';
      meeting.providerMetadata = { ...(meeting.providerMetadata || {}), cancellationMessage: `Cancelled in app. Zoom cancellation failed: ${error.message}`, cancelledAt: new Date() };
    }
  }
  meeting.status = 'cancelled';
  await meeting.save();
  await writeAuditLog({ req, action: 'meeting.cancelled', entityType: 'Meeting', entityId: meeting._id, summary: `Cancelled meeting ${meeting.title}` });
  res.json({ success: true, meeting: serializeMeetingForUser(meeting, req.user) });
});

export const sendMeetingReminders = asyncHandler(async (req, res) => {
  if (!['teacher', 'admin'].includes(req.user.role)) throw new ApiError(403, 'Only staff can send meeting reminders.');
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const query = { status: 'scheduled', startsAt: { $gte: now, $lte: soon }, reminderSentAt: null };
  if (req.user.role === 'teacher') query.host = req.user._id;
  const meetings = await Meeting.find(query).populate('classroom', 'name').populate('attendees', '_id');
  let notifications = 0;
  for (const meeting of meetings) {
    const docs = meeting.attendees.map((attendee) => ({ recipient: attendee._id, actor: req.user._id, classroom: meeting.classroom._id, type: 'meeting_reminder', title: `Reminder: ${meeting.title}`, message: `${meeting.classroom.name} meeting starts ${meeting.startsAt.toLocaleString()}.` }));
    if (docs.length) await Notification.insertMany(docs);
    meeting.reminderSentAt = new Date();
    await meeting.save();
    notifications += docs.length;
  }
  res.json({ success: true, message: `Sent ${notifications} meeting reminder notifications.`, meetingsProcessed: meetings.length });
});