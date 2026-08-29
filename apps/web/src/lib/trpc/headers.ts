import { getSessionToken } from '../storage';

export function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
