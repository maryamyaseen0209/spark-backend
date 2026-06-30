import { env } from '../config/env.js';

const baseCookie = {
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: env.cookieSecure ? 'none' : 'lax',
  path: '/',
};

export function setAuthCookies(res, accessToken, refreshToken, rememberMe = false) {
  res.cookie('accessToken', accessToken, { ...baseCookie, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...baseCookie, maxAge: rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 });
}

export function clearAuthCookies(res) {
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/' });
}
