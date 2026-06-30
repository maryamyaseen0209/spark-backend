import { env } from '../config/env.js';

function verificationTemplate({ fullName, code, verifyUrl }) {
  return {
    subject: 'Verify your Study SparkAI email',
    text: `Hi ${fullName},\n\nYour Study SparkAI verification code is ${code}. It expires in 15 minutes.\n\nYou can also verify here: ${verifyUrl}\n\nIf you did not request this, ignore this email.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a"><h2>Verify your Study SparkAI email</h2><p>Hi ${fullName},</p><p>Your verification code is:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px;color:#2563eb">${code}</p><p>This code expires in 15 minutes.</p><p><a href="${verifyUrl}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700">Verify email</a></p><p style="color:#64748b;font-size:13px">If you did not request this, ignore this email.</p></div>`,
  };
}

function passwordResetTemplate({ fullName, resetCode }) {
  return {
    subject: 'Reset your Study SparkAI password',
    text: `Hi ${fullName},\n\nUse the code below to reset your Study SparkAI password:\n\n${resetCode}\n\nThis code expires in ${env.passwordResetTtl}. If you did not request this, ignore this email.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a"><h2>Reset your Study SparkAI password</h2><p>Hi ${fullName},</p><p>Use the code below to reset your password:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px;color:#2563eb">${resetCode}</p><p>This code expires in ${env.passwordResetTtl}.</p><p style="color:#64748b;font-size:13px">If you did not request this, ignore this email.</p></div>`,
  };
}

function zoomHostSetupTemplate({ fullName, dashboardUrl }) {
  return {
    subject: 'Zoom setup required for Study SparkAI meetings',
    text: `Hi ${fullName},\n\nStudy SparkAI uses backend Zoom Server-to-Server OAuth credentials for Zoom meetings. Teachers remain the legal app host of their meetings, and Zoom can add eligible teachers as alternative hosts.\n\nOpen Live Meetings for the current setup status: ${dashboardUrl}\n\nAsk an admin to set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET in backend/.env if Zoom scheduling is unavailable.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a"><h2>Zoom setup required</h2><p>Hi ${fullName},</p><p>Study SparkAI uses backend Zoom Server-to-Server OAuth credentials for Zoom meetings. Teachers remain the legal app host of their meetings, and Zoom can add eligible teachers as alternative hosts.</p><p><a href="${dashboardUrl}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700">Open Live Meetings</a></p><p style="color:#64748b;font-size:13px">Ask an admin to set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET in backend/.env if Zoom scheduling is unavailable.</p></div>`,
  };
}

async function sendViaSmtp(message) {
  if (!env.email.enabled) return false;
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: env.email.host,
    port: env.email.port,
    secure: env.email.secure,
    auth: env.email.user && env.email.pass ? { user: env.email.user, pass: env.email.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    pool: true,
    maxConnections: 3,
  });
  await transporter.sendMail({ from: env.email.from, ...message });
  return true;
}

export async function sendVerificationEmail({ to, fullName, code, verifyUrl }) {
  const template = verificationTemplate({ fullName, code, verifyUrl });
  let sent = false;

  try {
    sent = await sendViaSmtp({ to, ...template });
  } catch (error) {
    console.warn('[email] Verification email delivery failed:', error.message);
  }

  if (!sent) {
    const reason = env.email.enabled ? 'SMTP delivery failed' : 'SMTP is not configured';
    console.info(`[email:dev] Verification email not sent because ${reason}.`, { to, code, verifyUrl });
  }

  // Always return devCode as a backup — Gmail and other providers may silently
  // drop emails from unverified senders (no SPF/DKIM) even when SMTP succeeds.
  return { sent, configured: env.email.enabled, devCode: code, verifyUrl };
}

export async function sendPasswordResetEmail({ to, fullName, resetCode }) {
  if (!resetCode) return { sent: false };

  const template = passwordResetTemplate({ fullName, resetCode });
  let sent = false;

  try {
    sent = await sendViaSmtp({ to, ...template });
  } catch (error) {
    console.warn('[email] Password reset email delivery failed:', error.message);
  }

  if (!sent) {
    const reason = env.email.enabled ? 'SMTP delivery failed' : 'SMTP is not configured';
    console.info(`[email:dev] Password reset email not sent because ${reason}.`, { to, resetCode });
  }

  return { sent, configured: env.email.enabled, devResetCode: sent ? undefined : resetCode };
}

export async function sendZoomHostSetupEmail({ to, fullName, dashboardUrl }) {
  const template = zoomHostSetupTemplate({ fullName, dashboardUrl });
  let sent = false;

  try {
    sent = await sendViaSmtp({ to, ...template });
  } catch (error) {
    console.warn('[email] Zoom host setup email delivery failed:', error.message);
  }

  if (!sent) {
    const reason = env.email.enabled ? 'SMTP delivery failed' : 'SMTP is not configured';
    console.info(`[email:dev] Zoom host setup email not sent because ${reason}.`, { to, dashboardUrl });
  }

  return { sent, configured: env.email.enabled, dashboardUrl };
}