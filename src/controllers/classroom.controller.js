import crypto from 'crypto';
import Classroom from '../models/Classroom.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const makeCode = () => crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
const populateClassroom = (query) => query.populate('teacher', 'fullName email avatarUrl').populate('students', 'fullName email role status institution');

async function uniqueCode() {
  let code = makeCode();
  while (await Classroom.exists({ joinCode: code })) code = makeCode();
  return code;
}

export const listClassrooms = asyncHandler(async (req, res) => {
  const query = req.user.role === 'teacher' ? { teacher: req.user._id } : req.user.role === 'student' ? { students: req.user._id } : {};
  const classrooms = await populateClassroom(Classroom.find(query)).sort({ createdAt: -1 });
  res.json({ success: true, classrooms });
});

export const getClassroom = asyncHandler(async (req, res) => {
  const classroom = await populateClassroom(Classroom.findById(req.params.id));
  if (!classroom) throw new ApiError(404, 'Classroom not found');
  if (req.user.role === 'student' && !classroom.students.some((id) => id._id.equals(req.user._id))) throw new ApiError(403, 'You are not enrolled in this classroom');
  if (req.user.role === 'teacher' && !classroom.teacher._id.equals(req.user._id)) throw new ApiError(403, 'You cannot access this classroom');
  res.json({ success: true, classroom });
});

export const createClassroom = asyncHandler(async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') throw new ApiError(403, 'Only teachers can create classrooms');
  const classroom = await Classroom.create({ ...req.body, teacher: req.user._id, joinCode: await uniqueCode() });
  res.status(201).json({ success: true, message: 'Classroom created successfully.', classroom });
});

export const updateClassroom = asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.id);
  if (!classroom) throw new ApiError(404, 'Classroom not found');
  if (req.user.role !== 'admin' && !classroom.teacher.equals(req.user._id)) throw new ApiError(403, 'You cannot update this classroom');
  ['name', 'subject', 'gradeLevel', 'section', 'academicYear', 'description', 'status'].forEach((field) => {
    if (req.body[field] !== undefined) classroom[field] = req.body[field];
  });
  if (req.body.communicationSettings && typeof req.body.communicationSettings === 'object') {
    classroom.communicationSettings ||= {};
    ['studentMessagingEnabled', 'announcementsOnly', 'commentsEnabled'].forEach((field) => {
      if (req.body.communicationSettings[field] !== undefined) classroom.communicationSettings[field] = Boolean(req.body.communicationSettings[field]);
    });
  }
  await classroom.save();
  await Notification.insertMany(classroom.students.map((student) => ({ recipient: student, actor: req.user._id, classroom: classroom._id, type: 'classroom_updated', title: 'Classroom updated', message: `${classroom.name} details were updated.` })), { ordered: false }).catch(() => {});
  res.json({ success: true, message: 'Classroom updated successfully.', classroom });
});

export const joinClassroom = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new ApiError(403, 'Only students can join classrooms');
  const code = String(req.body.joinCode || '').trim().toUpperCase();
  const classroom = await Classroom.findOne({ joinCode: code, status: 'active' });
  if (!classroom) throw new ApiError(404, 'No active classroom found for this code');
  if (!classroom.students.some((id) => id.equals(req.user._id))) classroom.students.push(req.user._id);
  await classroom.save();
  await Notification.create({ recipient: classroom.teacher, actor: req.user._id, classroom: classroom._id, type: 'classroom_enrollment', title: 'New classroom enrollment', message: `${req.user.fullName} joined ${classroom.name}.` });
  res.json({ success: true, message: `Joined ${classroom.name} successfully.`, classroom });
});

export const leaveClassroom = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new ApiError(403, 'Only students can leave classrooms');
  const classroom = await Classroom.findById(req.params.id);
  if (!classroom) throw new ApiError(404, 'Classroom not found');
  const before = classroom.students.length;
  classroom.students = classroom.students.filter((id) => !id.equals(req.user._id));
  if (classroom.students.length === before) throw new ApiError(400, 'You are not enrolled in this classroom');
  await classroom.save();
  await Notification.create({ recipient: classroom.teacher, actor: req.user._id, classroom: classroom._id, type: 'classroom_removed', title: 'Student left classroom', message: `${req.user.fullName} left ${classroom.name}.` });
  res.json({ success: true, message: `You left ${classroom.name}.` });
});

export const addStudent = asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.id);
  if (!classroom) throw new ApiError(404, 'Classroom not found');
  if (req.user.role !== 'admin' && !classroom.teacher.equals(req.user._id)) throw new ApiError(403, 'You cannot manage this classroom roster');
  const student = await User.findOne({ email: String(req.body.email || '').trim().toLowerCase(), role: 'student', status: 'active' });
  if (!student) throw new ApiError(404, 'Active student account not found for this email');
  if (!classroom.students.some((id) => id.equals(student._id))) classroom.students.push(student._id);
  await classroom.save();
  await Notification.create({ recipient: student._id, actor: req.user._id, classroom: classroom._id, type: 'classroom_enrollment', title: 'Added to classroom', message: `You were added to ${classroom.name}.` });
  const populated = await populateClassroom(Classroom.findById(classroom._id));
  res.json({ success: true, message: `${student.fullName} added to ${classroom.name}.`, classroom: populated });
});

export const removeStudent = asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.id);
  if (!classroom) throw new ApiError(404, 'Classroom not found');
  if (req.user.role !== 'admin' && !classroom.teacher.equals(req.user._id)) throw new ApiError(403, 'You cannot manage this classroom roster');
  const student = await User.findById(req.params.studentId);
  classroom.students = classroom.students.filter((id) => !id.equals(req.params.studentId));
  await classroom.save();
  if (student) await Notification.create({ recipient: student._id, actor: req.user._id, classroom: classroom._id, type: 'classroom_removed', title: 'Removed from classroom', message: `You were removed from ${classroom.name}.` });
  const populated = await populateClassroom(Classroom.findById(classroom._id));
  res.json({ success: true, message: 'Student removed from classroom.', classroom: populated });
});

export const regenerateJoinCode = asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.id);
  if (!classroom) throw new ApiError(404, 'Classroom not found');
  if (req.user.role !== 'admin' && !classroom.teacher.equals(req.user._id)) throw new ApiError(403, 'You cannot update this classroom');
  classroom.joinCode = await uniqueCode();
  await classroom.save();
  res.json({ success: true, message: 'Join code regenerated.', classroom });
});

export const deleteClassroom = asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.id);
  if (!classroom) throw new ApiError(404, 'Classroom not found');
  if (req.user.role !== 'admin' && !classroom.teacher.equals(req.user._id)) throw new ApiError(403, 'You cannot delete this classroom');
  await classroom.deleteOne();
  res.json({ success: true, message: 'Classroom deleted successfully.' });
});