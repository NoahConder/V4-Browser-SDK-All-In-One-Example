import axios from 'axios';
import type { TokenData, CallData, CallerId, SwmlScript, SipCredential, Subscriber } from '../types';

const API_BASE = '/api';

// Shared key for the gated token endpoints. vite.config.ts injects it from
// backend/.env's DIALER_API_KEY at build/dev-server start (there is no
// frontend/.env). Note: in a browser SPA this is discoverable by anyone who
// loads the page — it raises the bar against direct/automated abuse of the
// token endpoint, not against a determined user.
const API_KEY = import.meta.env.VITE_DIALER_API_KEY as string | undefined;

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
  },
});

// Human-readable copy for a failed backend request. axios's default message
// ("Request failed with status code 502") says nothing a tester can act on.
// The statuses are the backend's (utils/security.gate and the blueprints):
// 429 is the per-IP rate limit, 401/503 mean the key or the backend's
// configuration is off (the 503 body says which), 500 means a SignalWire REST
// call failed (details in the backend log, never in the body), and 502/504
// or no response at all mean Vite's /api proxy found nothing on :5001.
export const describeFetchError = (err: unknown, fallback: string): string => {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const serverMessage = (err.response?.data as { error?: unknown } | undefined)?.error;
    const detail = typeof serverMessage === 'string' ? serverMessage : null;
    if (status === 429) return 'Too many requests — wait a moment and try again.';
    if (status === 401) return 'The backend rejected the API key — restart the dev server after changing DIALER_API_KEY.';
    if (status === 503) return `${detail ?? 'Backend unavailable'} — check backend/.env and the backend log.`;
    if (status === 500) return "The backend couldn't complete the request — check its log.";
    if (status === 502 || status === 504 || !err.response) return 'Backend unreachable — is the Flask server running on :5001?';
  }
  return err instanceof Error ? err.message : fallback;
};

export const authAPI = {
  async getToken(subscriberId?: string): Promise<TokenData> {
    // subscriberId is only ever a value the user picked from subscribersAPI.list()
    // (backed by GET /api/subscribers) -- the backend revalidates it against the
    // account's real subscriber list regardless, same as it did before this was
    // added (see auth.py's _resolve_reference).
    const response = await api.post<{ success: boolean; data: TokenData }>('/auth/token', {
      subscriber_id: subscriberId,
    });
    if (!response.data.success) {
      throw new Error('Failed to get token');
    }
    return response.data.data;
  },

  async refreshToken(oldToken?: string, subscriberId?: string): Promise<TokenData> {
    const response = await api.post<{ success: boolean; data: TokenData }>('/auth/refresh', {
      token: oldToken,
      subscriber_id: subscriberId,
    });
    if (!response.data.success) {
      throw new Error('Failed to refresh token');
    }
    return response.data.data;
  },
};

// The backend's call log is cosmetic (see CLAUDE.md); the browser keeps its
// own Recents. Only the fire-and-forget dial post is used.
export const callsAPI = {
  // `from` is the caller ID chosen for a call to a phone number, when any,
  // so the backend's log line shows it too.
  async initiateCall(toNumber: string, from?: string): Promise<CallData> {
    const response = await api.post<{ success: boolean; data: CallData }>('/calls/dial', {
      to: toNumber,
      ...(from ? { from } : {}),
    });
    if (!response.data.success) {
      throw new Error('Failed to initiate call');
    }
    return response.data.data;
  },
};

export interface CallerIdsList {
  items: CallerId[];
  // Sources the backend couldn't list ('numbers' | 'verified'); the items
  // from the other are still returned.
  failed: string[];
}

// The caller IDs the server accepts on a call to a phone number: the space's
// phone numbers and its verified caller IDs. Unpaged (the picker shows all of
// them) and cached for a minute on the backend.
export const callerIdsAPI = {
  async list(): Promise<CallerIdsList> {
    const response = await api.get<{ success: boolean; data: CallerId[]; failed?: string[] }>('/caller-ids');
    if (!response.data.success) {
      throw new Error('Failed to get caller IDs');
    }
    return { items: response.data.data, failed: response.data.failed ?? [] };
  },
};

export interface SwmlScriptsPage {
  scripts: SwmlScript[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export const swmlAPI = {
  async listScripts(offset = 0, limit = 10, q = ''): Promise<SwmlScriptsPage> {
    const response = await api.get<{
      success: boolean;
      data: SwmlScript[];
      total: number;
      offset: number;
      limit: number;
      has_more: boolean;
    }>('/swml/scripts', {
      // `q` only when set, so an unfiltered page keeps the same URL as before.
      params: { offset, limit, ...(q ? { q } : {}) },
    });
    if (!response.data.success) {
      throw new Error('Failed to get SWML scripts');
    }
    return {
      scripts: response.data.data,
      total: response.data.total,
      offset: response.data.offset,
      limit: response.data.limit,
      hasMore: response.data.has_more,
    };
  },
};

export interface SipCredentialsPage {
  credentials: SipCredential[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export const sipAPI = {
  async listCredentials(offset = 0, limit = 10, q = ''): Promise<SipCredentialsPage> {
    const response = await api.get<{
      success: boolean;
      data: SipCredential[];
      total: number;
      offset: number;
      limit: number;
      has_more: boolean;
    }>('/sip/credentials', {
      params: { offset, limit, ...(q ? { q } : {}) },
    });
    if (!response.data.success) {
      throw new Error('Failed to get SIP credentials');
    }
    return {
      credentials: response.data.data,
      total: response.data.total,
      offset: response.data.offset,
      limit: response.data.limit,
      hasMore: response.data.has_more,
    };
  },
};

export interface SubscribersPage {
  subscribers: Subscriber[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export const subscribersAPI = {
  async list(offset = 0, limit = 10): Promise<SubscribersPage> {
    const response = await api.get<{
      success: boolean;
      data: Subscriber[];
      total: number;
      offset: number;
      limit: number;
      has_more: boolean;
    }>('/subscribers', {
      params: { offset, limit },
    });
    if (!response.data.success) {
      throw new Error('Failed to get subscribers');
    }
    return {
      subscribers: response.data.data,
      total: response.data.total,
      offset: response.data.offset,
      limit: response.data.limit,
      hasMore: response.data.has_more,
    };
  },
};