import Classroom from '../models/Classroom.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import Resource from '../models/Resource.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { emitNotification, emitToClassroom } from '../services/realtime.service.js';
import { deleteStoredResourceFile, inferResourceType, storeResourceFile } from '../services/uploads.service.js';

const populateResource = (query) => query
  .populate('uploadedBy', 'fullName email role avatarUrl')
  .populate('classroom', 'name subject teacher students communicationSettings')
  .populate('comments.author', 'fullName email role avatarUrl');

async function getAccessibleClassroom(user, classroomId) {
  const classroom = await Classroom.findById(classroomId);
  if (!classroom) throw new ApiError(404, 'Classroom not found');
  const isTeacher = classroom.teacher.equals(user._id);
  const isStudent = classroom.students.some((id) => id.equals(user._id));
  if (user.role !== 'admin' && !isTeacher && !isStudent) throw new ApiError(403, 'You cannot access resources for this classroom');
  return classroom;
}

function canManageResource(user, classroom, resource) {
  return user.role === 'admin' || classroom.teacher.equals(user._id) || resource?.uploadedBy?.equals?.(user._id);
}

async function notifyClassroom(req, classroom, resource, title, message, type = 'resource_added') {
  const recipients = classroom.students.filter((id) => !id.equals(req.user._id));
  if (!classroom.teacher.equals(req.user._id)) recipients.push(classroom.teacher);
  const docs = recipients.map((recipient) => ({ recipient, actor: req.user._id, classroom: classroom._id, resourceRef: resource._id, type, title, message }));
  const notifications = docs.length ? await Notification.insertMany(docs, { ordered: false }).catch(() => []) : [];
  notifications.forEach((notification) => emitNotification(req, notification));
  emitToClassroom(req, classroom._id, 'resource:updated', { resourceId: resource._id, action: type });
}

async function createResourceMessage(req, classroom, resource) {
  const content = `${req.user.fullName} uploaded a new resource: ${resource.title}. Open the classroom resources section to preview or download it.`;
  const message = await Message.create({
    sender: req.user._id,
    classroom: classroom._id,
    kind: 'announcement',
    priority: 'important',
    content,
    attachments: [{ name: resource.title, url: resource.url, fileType: resource.mimeType || resource.type, size: resource.size }],
    pinned: true,
    readBy: [{ user: req.user._id, readAt: new Date() }],
  });
  const populated = await Message.findById(message._id).populate('sender', 'fullName email role avatarUrl');
  emitToClassroom(req, classroom._id, 'message:new', { message: populated });
  return populated;
}

export const listResources = asyncHandler(async (req, res) => {
  const { classroomId, search, type } = req.query;
  const filter = { status: { $ne: 'archived' } };
  if (classroomId) {
    await getAccessibleClassroom(req.user, classroomId);
    filter.classroom = classroomId;
  } else if (req.user.role !== 'admin') {
    const classrooms = await Classroom.find(req.user.role === 'teacher' ? { teacher: req.user._id } : { students: req.user._id }).select('_id');
    filter.classroom = { $in: classrooms.map((room) => room._id) };
  }
  if (type && type !== 'all') filter.type = type;
  if (search) filter.$text = { $search: String(search).slice(0, 80) };
  const resources = await populateResource(Resource.find(filter)).sort({ pinned: -1, createdAt: -1 }).limit(80);
  res.json({ success: true, resources });
});

export const createResource = asyncHandler(async (req, res) => {
  const classroom = await getAccessibleClassroom(req.user, req.body.classroomId);
  if (req.user.role !== 'teacher' || !classroom.teacher.equals(req.user._id)) throw new ApiError(403, 'Only the classroom teacher can share resources');
  const storedFile = await storeResourceFile(req.file);
  const externalUrl = String(req.body.url || '').trim();
  if (!storedFile && !externalUrl) throw new ApiError(400, 'Upload a file or provide a resource link');
  const tags = String(req.body.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  const resource = await Resource.create({
    classroom: classroom._id,
    uploadedBy: req.user._id,
    title: req.body.title,
    description: req.body.description,
    tags,
    commentsEnabled: req.body.commentsEnabled !== 'false',
    ...(storedFile || { url: externalUrl, storageProvider: 'external', type: inferResourceType('', externalUrl) }),
  });
  const populated = await populateResource(Resource.findById(resource._id));
  await createResourceMessage(req, classroom, resource);
  await notifyClassroom(req, classroom, resource, 'New classroom resource', `${req.user.fullName} shared ${resource.title}.`);
  res.status(201).json({ success: true, message: 'Resource shared successfully.', resource: populated });
});

export const updateResource = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new ApiError(404, 'Resource not found');
  const classroom = await getAccessibleClassroom(req.user, resource.classroom);
  if (!canManageResource(req.user, classroom, resource)) throw new ApiError(403, 'You cannot update this resource');
  ['title', 'description', 'status'].forEach((field) => { if (req.body[field] !== undefined) resource[field] = req.body[field]; });
  if (req.body.commentsEnabled !== undefined) resource.commentsEnabled = req.body.commentsEnabled === true || req.body.commentsEnabled === 'true';
  if (req.body.pinned !== undefined && (req.user.role === 'admin' || classroom.teacher.equals(req.user._id))) resource.pinned = Boolean(req.body.pinned);
  if (req.body.tags !== undefined) resource.tags = String(req.body.tags).split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  await resource.save();
  const populated = await populateResource(Resource.findById(resource._id));
  emitToClassroom(req, classroom._id, 'resource:updated', { resourceId: resource._id, action: 'resource_updated' });
  res.json({ success: true, message: 'Resource updated successfully.', resource: populated });
});

export const deleteResource = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new ApiError(404, 'Resource not found');
  const classroom = await getAccessibleClassroom(req.user, resource.classroom);
  if (!canManageResource(req.user, classroom, resource)) throw new ApiError(403, 'You cannot delete this resource');
  await deleteStoredResourceFile(resource).catch((error) => {
    console.warn(`Resource asset cleanup failed for ${resource._id}:`, error.message);
  });
  resource.status = 'archived';
  await resource.save();
  emitToClassroom(req, classroom._id, 'resource:updated', { resourceId: resource._id, action: 'resource_deleted' });
  res.json({ success: true, message: 'Resource deleted successfully.' });
});

export const recordResourceView = asyncHandler(async (req, res) => {
  const resource = await populateResource(Resource.findById(req.params.id));
  if (!resource) throw new ApiError(404, 'Resource not found');
  await getAccessibleClassroom(req.user, resource.classroom._id);
  if (req.body.kind === 'download') resource.downloads += 1;
  else resource.previewCount += 1;
  await resource.save();
  res.json({ success: true, resource });
});

export const addComment = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new ApiError(404, 'Resource not found');
  const classroom = await getAccessibleClassroom(req.user, resource.classroom);
  if (!resource.commentsEnabled || classroom.communicationSettings?.commentsEnabled === false) throw new ApiError(403, 'Comments are disabled for this resource');
  resource.comments.push({ author: req.user._id, body: req.body.body, parentComment: req.body.parentComment || undefined });
  await resource.save();
  const populated = await populateResource(Resource.findById(resource._id));
  await notifyClassroom(req, classroom, resource, 'New resource comment', `${req.user.fullName} commented on ${resource.title}.`, 'resource_commented');
  res.status(201).json({ success: true, message: 'Comment added.', resource: populated });
});

export const updateComment = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new ApiError(404, 'Resource not found');
  const classroom = await getAccessibleClassroom(req.user, resource.classroom);
  const comment = resource.comments.id(req.params.commentId);
  if (!comment || comment.deletedAt) throw new ApiError(404, 'Comment not found');
  const owns = comment.author.equals(req.user._id);
  const manages = req.user.role === 'admin' || classroom.teacher.equals(req.user._id);
  if (req.body.action === 'upvote') {
    const already = comment.upvotes.some((id) => id.equals(req.user._id));
    comment.upvotes = already ? comment.upvotes.filter((id) => !id.equals(req.user._id)) : [...comment.upvotes, req.user._id];
  } else if (req.body.action === 'pin') {
    if (!manages) throw new ApiError(403, 'Only teachers can pin comments');
    comment.pinned = !comment.pinned;
  } else if (req.body.action === 'moderate') {
    if (!manages) throw new ApiError(403, 'Only teachers can moderate comments');
    comment.moderated = true;
  } else if (req.body.action === 'delete') {
    if (!owns && !manages) throw new ApiError(403, 'You cannot delete this comment');
    comment.deletedAt = new Date();
  } else if (req.body.body && owns) {
    comment.body = req.body.body;
  } else {
    throw new ApiError(400, 'Unsupported comment action');
  }
  await resource.save();
  const populated = await populateResource(Resource.findById(resource._id));
  emitToClassroom(req, classroom._id, 'resource:updated', { resourceId: resource._id, action: 'resource_comment_updated' });
  res.json({ success: true, message: 'Comment updated.', resource: populated });
});