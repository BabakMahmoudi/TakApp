import { getAdminToken, getAnonymousKey, getSessionToken } from '../storage';

export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const adminToken = getAdminToken();
  if (adminToken) headers['x-admin-token'] = adminToken;
  const anonymousKey = getAnonymousKey();
  if (anonymousKey) headers['x-anonymous-key'] = anonymousKey;
  return headers;
}
