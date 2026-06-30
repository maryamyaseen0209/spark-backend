import { env } from '../src/config/env.js';

const mask = (value) => (value ? 'set' : 'missing');

const result = {
  cloudinary: {
    configured: env.cloudinary.enabled,
    cloudName: mask(env.cloudinary.cloudName),
    apiKey: mask(env.cloudinary.apiKey),
    apiSecret: mask(env.cloudinary.apiSecret),
    uploadFolder: env.cloudinary.uploadFolder,
    auth: 'not_checked',
  },
  zoom: {
    configured: env.zoom.enabled,
    accountId: mask(env.zoom.accountId),
    clientId: mask(env.zoom.clientId),
    clientSecret: mask(env.zoom.clientSecret),
    hostUserId: env.zoom.hostUserId || 'missing',
    timezone: env.zoom.timezone,
    oauth: 'not_checked',
    hostLookup: 'not_checked',
  },
};

async function checkCloudinary() {
  if (!env.cloudinary.enabled) return;

  const credentials = Buffer.from(`${env.cloudinary.apiKey}:${env.cloudinary.apiSecret}`).toString('base64');
  const response = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/usage`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  result.cloudinary.auth = response.ok ? 'ok' : `failed_${response.status}`;
  if (!response.ok) result.cloudinary.message = await response.text();
}

async function checkZoom() {
  if (!env.zoom.enabled) return;

  const credentials = Buffer.from(`${env.zoom.clientId}:${env.zoom.clientSecret}`).toString('base64');
  const tokenResponse = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${env.zoom.accountId}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
  });
  result.zoom.oauth = tokenResponse.ok ? 'ok' : `failed_${tokenResponse.status}`;
  if (!tokenResponse.ok) {
    result.zoom.message = await tokenResponse.text();
    return;
  }

  const tokenData = await tokenResponse.json();
  const hostPath = env.zoom.hostUserId && env.zoom.hostUserId !== 'me'
    ? `/v2/users/${encodeURIComponent(env.zoom.hostUserId)}`
    : '/v2/users?status=active&page_size=1';
  const hostResponse = await fetch(`https://api.zoom.us${hostPath}`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  result.zoom.hostLookup = hostResponse.ok ? 'ok' : `failed_${hostResponse.status}`;
  if (!hostResponse.ok) result.zoom.message = await hostResponse.text();
}

await Promise.allSettled([checkCloudinary(), checkZoom()]);
console.log(JSON.stringify(result, null, 2));