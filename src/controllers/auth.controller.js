import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import EmailVerification from '../models/EmailVerification.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signAccessToken, signRefreshToken, signResetToken } from '../utils/tokens.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookies.js';
import Notification from '../models/Notification.js';
import { emitNotification } from '../services/realtime.service.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../services/email.service.js';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const publicUser = (user) => ({ id: user.id, fullName: user.fullName, email: user.email, role: user.role, status: user.status, emailVerified: user.emailVerified, institution: user.institution, avatarUrl: user.avatarUrl, bio: user.bio, preferences: user.preferences });
const bearerToken = (req) => req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.replace('Bearer ', '') : null;
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const createVerificationCode = () => crypto.randomInt(100000, 999999).toString();

function authLinks(req, path, token) {
  return `${env.clientUrl}${path}?token=${encodeURIComponent(token)}`;
}

async function createSessionResponse(req, res, user, message, rememberMe = false) {
  const session = user.sessions.create({ userAgent: req.get('user-agent'), ip: req.ip, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), refreshTokenHash: 'pending' });
  user.sessions.push(session);
  const refreshToken = signRefreshToken(user, session._id.toString());
  session.refreshTokenHash = hashToken(refreshToken);
  await user.save();
  const accessToken = signAccessToken(user);
  setAuthCookies(res, accessToken, refreshToken, rememberMe);
  return res.status(message.statusCode || 200).json({ success: true, message: message.text, user: publicUser(user), accessToken, refreshToken });
}

export const startRegistration = asyncHandler(async (req, res) => {
  const { fullName, password, role, institution } = req.body;
  const email = normalizeEmail(req.body.email);
  if (role === 'admin') throw new ApiError(403, 'Admin accounts must be created directly by a database administrator');

  const existing = await User.findOne({ email });
  if (existing) throw new ApiError(409, 'Email is already registered');

  const code = createVerificationCode();
  await EmailVerification.deleteMany({ email });
  const verification = await EmailVerification.create({
    email,
    fullName,
    password,
    role,
    institution,
    codeHash: hashToken(code),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const verifyUrl = `${env.clientUrl}/verify-email?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`;
  const delivery = await sendVerificationEmail({ to: email, fullName, code, verifyUrl });
  res.status(202).json({
    success: true,
    message: delivery.sent
      ? 'Verification email sent. Enter the code to finish registration.'
      : 'Verification code created. If the email does not arrive, please request a new code or contact support.',
    email,
    verificationId: verification.id,
    emailSent: delivery.sent,
    devCode: delivery.devCode,
  });
});

export const register = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { code } = req.body;
  const existing = await User.findOne({ email });
  if (existing) throw new ApiError(409, 'Email is already registered');

  const verification = await EmailVerification.findOne({ email }).select('+password').sort({ createdAt: -1 });
  if (!verification || verification.expiresAt < new Date()) throw new ApiError(400, 'Verification code is invalid or expired');
  if (verification.attempts >= 5) throw new ApiError(429, 'Too many verification attempts. Please request a new code.');
  if (verification.codeHash !== hashToken(code)) {
    verification.attempts += 1;
    await verification.save();
    throw new ApiError(400, 'Verification code is incorrect');
  }

  const user = await User.create({
    fullName: verification.fullName,
    email: verification.email,
    password: verification.password,
    role: verification.role,
    institution: verification.institution,
    status: 'active',
    emailVerified: true,
  });
  await EmailVerification.deleteMany({ email });
  return createSessionResponse(req, res, user, { statusCode: 201, text: 'Email verified. Welcome to Study SparkAI.' }, false);
});

export const login = asyncHandler(async (req, res) => {
  const { email, password, rememberMe = false } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) throw new ApiError(401, 'Invalid email or password');
  if (!user.emailVerified) throw new ApiError(403, 'Please verify your email before logging in');
  if (user.status === 'pending') user.status = 'active';
  if (user.status !== 'active') throw new ApiError(403, 'Account is not active');

  return createSessionResponse(req, res, user, { text: 'Login successful' }, rememberMe);
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.body.refreshToken || bearerToken(req) || req.cookies.refreshToken;
  if (!token) throw new ApiError(401, 'Refresh token is required');
  const payload = jwt.verify(token, env.jwtRefreshSecret);
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') throw new ApiError(401, 'Invalid refresh token');
  const session = user.sessions.id(payload.sid);
  if (!session || session.refreshTokenHash !== hashToken(token)) throw new ApiError(401, 'Refresh session not found');

  const newRefreshToken = signRefreshToken(user, session._id.toString());
  session.refreshTokenHash = hashToken(newRefreshToken);
  session.lastActiveAt = new Date();
  await user.save();
  const accessToken = signAccessToken(user);
  setAuthCookies(res, accessToken, newRefreshToken, true);
  res.json({ success: true, user: publicUser(user), accessToken, refreshToken: newRefreshToken });
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.body.refreshToken || bearerToken(req) || req.cookies.refreshToken;
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwtRefreshSecret);
      await User.updateOne({ _id: payload.sub }, { $pull: { sessions: { _id: payload.sid } } });
    } catch { }
  }
  clearAuthCookies(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { fullName, institution = '', bio = '', preferences = {} } = req.body;
  const user = await User.findById(req.user._id);
  if (!user) throw new ApiError(404, 'User not found');

  user.fullName = fullName;
  user.institution = institution;
  user.bio = bio;
  const currentPreferences = user.preferences?.toObject?.() || user.preferences || {};
  user.preferences = { ...currentPreferences, ...preferences };
  await user.save();

  const notification = await Notification.create({
    recipient: user._id,
    actor: user._id,
    type: 'profile_updated',
    title: 'Profile updated',
    message: 'Your profile details were updated successfully.',
  });
  emitNotification(req, notification);

  res.json({ success: true, message: 'Profile updated successfully.', user: publicUser(user), notification });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = await User.findOne({ email }).select('+resetCodeHash');
  if (!user) {
    return res.json({
      success: true,
      message: 'If an account exists, a password reset email has been sent.',
      emailSent: false,
    });
  }

  const resetCode = createVerificationCode();
  user.resetCodeHash = hashToken(resetCode);
  user.resetCodeExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  const delivery = await sendPasswordResetEmail({ to: user.email, fullName: user.fullName, resetCode });

  res.json({
    success: true,
    message: 'If an account exists, a password reset email has been sent.',
    emailSent: delivery.sent,
    devResetCode: delivery.sent ? undefined : resetCode,
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, email, code, password } = req.body;

  if (token) {
    const payload = jwt.verify(token, env.jwtResetSecret);
    const user = await User.findById(payload.sub).select('+password');
    if (!user || user.passwordResetVersion !== payload.tokenVersion) throw new ApiError(400, 'Invalid or expired reset token');
    user.password = password;
    user.passwordResetVersion += 1;
    user.sessions = [];
    await user.save();
    clearAuthCookies(res);
    return res.json({ success: true, message: 'Password reset successful. Please log in again.' });
  }

  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ email: normalizedEmail }).select('+resetCodeHash +password');
  if (!user || !user.resetCodeHash || !user.resetCodeExpiresAt || user.resetCodeExpiresAt < new Date()) {
    throw new ApiError(400, 'Invalid or expired reset code');
  }

  if (hashToken(code) !== user.resetCodeHash) {
    throw new ApiError(400, 'Invalid reset code');
  }

  if (await user.comparePassword(password)) {
    throw new ApiError(400, 'Your new password must be different from your previous password');
  }

  user.password = password;
  user.passwordResetVersion += 1;
  user.sessions = [];
  user.resetCodeHash = undefined;
  user.resetCodeExpiresAt = undefined;
  await user.save();
  clearAuthCookies(res);
  res.json({ success: true, message: 'Password reset successful. Please log in again.' });
});

export const sessions = asyncHandler(async (req, res) => {
  res.json({ success: true, sessions: req.user.sessions.map((s) => ({ id: s.id, userAgent: s.userAgent, ip: s.ip, lastActiveAt: s.lastActiveAt, createdAt: s.createdAt })) });
});

export const revokeSession = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $pull: { sessions: { _id: req.params.sessionId } } });
  res.json({ success: true, message: 'Session revoked' });
});
