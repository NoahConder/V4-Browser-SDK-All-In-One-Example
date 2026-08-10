import axios from 'axios';
import type { TokenData, CallData, SwmlScript, SipCredential, Subscriber } from '../types';

const API_BASE = '/api';

// Shared secret for the gated token endpoints (baked at build time). Note: in a
// browser SPA this is discoverable by anyone who loads the page — it raises the
// bar against direct/automated abuse of the token endpoint, not against a
// determined user. Pair with edge auth for real protection.
const API_KEY = import.meta.env.VITE_DIALER_API_KEY as string | undefined;

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
  },
});

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

export const callsAPI = {
  async initiateCall(toNumber: string): Promise<CallData> {
    const response = await api.post<{ success: boolean; data: CallData }>('/calls/dial', {
      to: toNumber,
    });
    if (!response.data.success) {
      throw new Error('Failed to initiate call');
    }
    return response.data.data;
  },

  async endCall(callId: string): Promise<CallData> {
    const response = await api.post<{ success: boolean; data: CallData }>(`/calls/end/${callId}`);
    if (!response.data.success) {
      throw new Error('Failed to end call');
    }
    return response.data.data;
  },

  async getCallStatus(callId: string): Promise<CallData> {
    const response = await api.get<{ success: boolean; data: CallData }>(`/calls/status/${callId}`);
    if (!response.data.success) {
      throw new Error('Failed to get call status');
    }
    return response.data.data;
  },

  async getCallHistory(limit = 50): Promise<CallData[]> {
    const response = await api.get<{ success: boolean; data: CallData[] }>('/calls/history', {
      params: { limit },
    });
    if (!response.data.success) {
      throw new Error('Failed to get call history');
    }
    return response.data.data;
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
  async listScripts(offset = 0, limit = 10): Promise<SwmlScriptsPage> {
    const response = await api.get<{
      success: boolean;
      data: SwmlScript[];
      total: number;
      offset: number;
      limit: number;
      has_more: boolean;
    }>('/swml/scripts', {
      params: { offset, limit },
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
  async listCredentials(offset = 0, limit = 10): Promise<SipCredentialsPage> {
    const response = await api.get<{
      success: boolean;
      data: SipCredential[];
      total: number;
      offset: number;
      limit: number;
      has_more: boolean;
    }>('/sip/credentials', {
      params: { offset, limit },
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