import { env } from '../config/env.js';

let cachedToken = null;
const cachedHostUserIds = new Map();

function isEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

function assertZoomConfigured() {
  if (!env.zoom.enabled) {
    return {
      configured: false,
      providerStatus: 'configuration_required',
      message: 'Zoom credentials are not configured. Add Zoom env vars to enable live meeting creation.',
    };
  }
  return null;
}

async function parseZoomResponse(response, failurePrefix) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) throw new Error(`${failurePrefix}: ${response.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

const zoomFailure = (message) => ({
  configured: false,
  providerStatus: 'failed',
  joinUrl: null,
  startUrl: null,
  providerMeetingId: null,
  message,
});

function isZoomNoPrivilegeError(detail = '') {
  return /"code"\s*:\s*200/.test(detail) && /no privilege/i.test(detail);
}

function zoomUserManagementPrivilegeMessage(action) {
  return `${action}. The Zoom credentials are valid, but the connected Server-to-Server OAuth app/account does not have permission to manage users. In Zoom Marketplace, add/admin-approve the User scopes for viewing and managing users, such as user:read:user:admin, user:read:list_users:admin, user:write:user:admin, and user:update:user:admin (older Zoom apps may show user:read:admin and user:write:admin), make sure the app owner is a Zoom account admin, then reactivate the app. Otherwise, add the teacher manually in Zoom as an active licensed user.`;
}

async function getZoomAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const credentials = Buffer.from(`${env.zoom.clientId}:${env.zoom.clientSecret}`).toString('base64');
  const response = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${env.zoom.accountId}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Zoom OAuth failed: ${response.status} ${detail}`);
  }

  const data = await response.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in || 3600) - 120) * 1000,
  };
  return cachedToken.value;
}

async function fetchZoomUser(token, userIdOrEmail) {
  const response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(userIdOrEmail)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Zoom host lookup failed for ${userIdOrEmail}: ${response.status} ${detail}. The teacher email must be an active user in the Zoom account connected to this Server-to-Server OAuth app.`);
  }

  return response.json();
}

async function fetchZoomUserIfExists(token, userIdOrEmail) {
  const response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(userIdOrEmail)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Zoom user lookup failed for ${userIdOrEmail}: ${response.status} ${detail}`);
  }

  return response.json();
}

async function updateZoomUserLicenseType(token, userIdOrEmail, type = 2) {
  const response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(userIdOrEmail)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (isZoomNoPrivilegeError(detail)) {
      throw new Error(zoomUserManagementPrivilegeMessage(`Zoom refused to upgrade ${userIdOrEmail} to a licensed user`));
    }
    throw new Error(`Zoom could not upgrade ${userIdOrEmail} to a licensed user: ${response.status} ${detail}`);
  }
}

async function getZoomHostUserId(token, preferredHostUserId) {
  const requestedHost = preferredHostUserId || env.zoom.hostUserId;
  if (requestedHost && requestedHost !== 'me') {
    const cacheKey = normalizeEmail(requestedHost) || requestedHost;
    if (cachedHostUserIds.has(cacheKey)) return cachedHostUserIds.get(cacheKey);

    const host = await fetchZoomUser(token, requestedHost);
    if (isEmail(requestedHost) && normalizeEmail(host.email) !== normalizeEmail(requestedHost)) {
      throw new Error(`Zoom resolved ${requestedHost} to ${host.email || 'an unknown email'}. Refusing to create the meeting under the wrong host.`);
    }

    const hostUserId = host.id || host.email || requestedHost;
    cachedHostUserIds.set(cacheKey, hostUserId);
    return hostUserId;
  }

  const response = await fetch('https://api.zoom.us/v2/users?status=active&page_size=1', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Zoom host lookup failed: ${response.status} ${detail}. Set ZOOM_HOST_USER_ID to a Zoom user email or user id, or grant the Server-to-Server OAuth app user read scopes.`);
  }

  const data = await response.json();
  const host = data.users?.[0];
  if (!host?.id && !host?.email) {
    throw new Error('Zoom host lookup failed: no active Zoom users were returned. Set ZOOM_HOST_USER_ID to a Zoom user email or user id.');
  }

  const fallbackHost = host.id || host.email;
  cachedHostUserIds.set('me', fallbackHost);
  return fallbackHost;
}

export async function inviteZoomUser(email, { type = 2 } = {}) {
  const token = await getZoomAccessToken();
  const response = await fetch('https://api.zoom.us/v2/users', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'create',
      user_info: {
        email,
        type,
      }
    }),
  });
  
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 409) {
      const existingUser = await fetchZoomUserIfExists(token, email);
      if (existingUser?.type !== 2) {
        await updateZoomUserLicenseType(token, existingUser.id || email, 2);
        return { success: true, message: 'Teacher is already in your Zoom account and was upgraded/requested as a licensed user.' };
      }
      return { success: true, message: 'Teacher is already a licensed user in your Zoom account.' };
    }
    if (isZoomNoPrivilegeError(detail)) {
      throw new Error(zoomUserManagementPrivilegeMessage(`Zoom refused to invite ${email}`));
    }
    throw new Error(`Failed to invite user to Zoom: ${detail}`);
  }
  
  return { success: true, message: 'Zoom invitation sent as a licensed user. The teacher must accept the email from Zoom before they can be used as an alternative host.' };
}

export async function ensureZoomAlternativeHostEligible(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isEmail(normalizedEmail)) return { eligible: false, message: 'Teacher email is missing or invalid, so Zoom alternative-host eligibility cannot be checked.' };

  const token = await getZoomAccessToken();
  const existingUser = await fetchZoomUserIfExists(token, normalizedEmail);

  if (!existingUser) {
    const invite = await inviteZoomUser(normalizedEmail, { type: 2 });
    return {
      eligible: false,
      invited: true,
      message: `${invite.message} After acceptance, schedule the Zoom meeting again.`,
    };
  }

  const status = String(existingUser.status || '').toLowerCase();
  if (status && status !== 'active') {
    return {
      eligible: false,
      invited: false,
      message: `${normalizedEmail} is already in the connected Zoom account but is currently ${existingUser.status}. The teacher must activate/accept the Zoom account invitation before becoming an alternative host.`,
    };
  }

  if (existingUser.type !== 2) {
    await updateZoomUserLicenseType(token, existingUser.id || normalizedEmail, 2);
    return {
      eligible: true,
      upgraded: true,
      message: `${normalizedEmail} was upgraded/requested as a licensed Zoom user.`,
    };
  }

  return { eligible: true, message: `${normalizedEmail} is already an active licensed Zoom user.` };
}

export async function createZoomMeeting({ title, startsAt, durationMinutes, hostUserId, alternativeHostEmail }) {
  const missingConfig = assertZoomConfigured();
  if (missingConfig) {
    return {
      ...missingConfig,
      joinUrl: null,
      startUrl: null,
      providerMeetingId: null,
    };
  }

  try {
    return await createLiveZoomMeeting({ title, startsAt, durationMinutes, hostUserId, alternativeHostEmail });
  } catch (error) {
    console.warn('Zoom meeting creation failed:', error.message);
    return zoomFailure(`Zoom meeting could not be created: ${error.message}`);
  }
}

async function createLiveZoomMeeting({ title, startsAt, durationMinutes, hostUserId, alternativeHostEmail }) {
  const token = await getZoomAccessToken();
  const zoomHostUserId = await getZoomHostUserId(token, hostUserId);
  return createLiveZoomMeetingWithToken({ token, title, startsAt, durationMinutes, hostUserId: zoomHostUserId, requestedHostEmail: hostUserId, alternativeHostEmail });
}

async function createLiveZoomMeetingWithToken({ token, title, startsAt, durationMinutes, hostUserId, requestedHostEmail, alternativeHostEmail }) {
  const normalizedAlternativeHostEmail = isEmail(alternativeHostEmail) ? normalizeEmail(alternativeHostEmail) : undefined;
  const createMeeting = async (alternativeHost) => fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(hostUserId)}/meetings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic: title,
      type: 2,
      start_time: startsAt.toISOString(),
      duration: durationMinutes,
      timezone: env.zoom.timezone,
      settings: {
        ...(alternativeHost ? { alternative_hosts: alternativeHost } : {}),
        waiting_room: env.zoom.waitingRoom,
        join_before_host: env.zoom.joinBeforeHost,
        mute_upon_entry: env.zoom.muteUponEntry,
        auto_recording: env.zoom.autoRecording,
        approval_type: 2,
        audio: 'both',
      },
    }),
  });
  let response = await createMeeting(normalizedAlternativeHostEmail);
  let alternativeHostWarning;

  if (!response.ok) {
    const detail = await response.text();
    const isAlternativeHostRejection = normalizedAlternativeHostEmail && response.status === 400 && /alternative host/i.test(detail);
    if (isAlternativeHostRejection) {
      try {
        const eligibility = await ensureZoomAlternativeHostEligible(normalizedAlternativeHostEmail);
        if (eligibility.eligible) {
          response = await createMeeting(normalizedAlternativeHostEmail);
        }
        if (!eligibility.eligible || !response.ok) {
          alternativeHostWarning = `Zoom could not assign ${normalizedAlternativeHostEmail} as an alternative host, so the meeting was created under the shared host only. ${eligibility.message}`;
          response = await createMeeting(undefined);
        }
      } catch (eligibilityError) {
        alternativeHostWarning = `Zoom could not assign ${normalizedAlternativeHostEmail} as an alternative host, so the meeting was created under the shared host only. I tried to make that teacher eligible in the connected Zoom account, but Zoom rejected the user/license action: ${eligibilityError.message}`;
        response = await createMeeting(undefined);
      }
    }
    if (!response.ok) {
      const retryDetail = isAlternativeHostRejection ? await response.text() : detail;
      throw new Error(`Zoom meeting creation failed: ${response.status} ${retryDetail}`);
    }
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Zoom meeting creation failed: ${response.status} ${detail}`);
  }

  const meeting = await response.json();


  return {
    configured: true,
    providerStatus: 'configured',
    joinUrl: meeting.join_url,
    startUrl: meeting.start_url,
    providerMeetingId: String(meeting.id),
    password: meeting.password,
    hostEmail: meeting.host_email,
    alternativeHosts: alternativeHostWarning || !normalizedAlternativeHostEmail ? [] : [normalizedAlternativeHostEmail],
    alternativeHostWarning,
    startTime: meeting.start_time,
    message: alternativeHostWarning
      ? `Zoom meeting created for ${title}. ${alternativeHostWarning}`
      : normalizedAlternativeHostEmail
      ? `Zoom meeting created for ${title}. ${normalizedAlternativeHostEmail} was assigned as an alternative host.`
      : `Zoom meeting created for ${title} at ${startsAt.toISOString()} (${durationMinutes} minutes).`,
  };
}

export async function cancelZoomMeeting(providerMeetingId) {
  const missingConfig = assertZoomConfigured();
  if (missingConfig) return { ...missingConfig, cancelled: false };
  if (!providerMeetingId) return { cancelled: false, message: 'Missing Zoom meeting id.' };
  const token = await getZoomAccessToken();
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(providerMeetingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 204 || response.status === 404) {
    return { cancelled: true, providerStatus: 'cancelled', message: response.status === 404 ? 'Zoom meeting was already removed.' : 'Zoom meeting cancelled.' };
  }
  const detail = await response.text();
  throw new Error(`Zoom meeting cancellation failed: ${response.status} ${detail}`);
}