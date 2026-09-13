'use client';

import { supabase } from './cloud-sync';

export type FudoConnectionStatus = {
  connected: boolean;
  status: 'connected' | 'error' | 'disconnected';
  lastSyncAt: string | null;
  lastError: string | null;
  lastSyncSalesCount: number;
};

export type FudoSyncResult = {
  imported: number;
  fromDate: string;
  cashKnown: number;
  salesTotal: number;
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Ingresá a tu cuenta Lebu para usar FUDO.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function parseResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) throw new Error(String(body?.message || `Error HTTP ${response.status}`));
  return body;
}

export async function getFudoStatus(businessId: string): Promise<FudoConnectionStatus> {
  const response = await fetch(`/api/integrations/fudo?businessId=${encodeURIComponent(businessId)}`, { headers: await authHeaders(), cache: 'no-store' });
  const body = await parseResponse(response);
  return {
    connected: Boolean(body.connected),
    status: body.status === 'error' ? 'error' : body.connected ? 'connected' : 'disconnected',
    lastSyncAt: body.lastSyncAt || null,
    lastError: body.lastError || null,
    lastSyncSalesCount: Number(body.lastSyncSalesCount || 0),
  };
}

export async function connectFudo(businessId: string, apiKey: string, apiSecret: string) {
  const response = await fetch(`/api/integrations/fudo?businessId=${encodeURIComponent(businessId)}`, {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ apiKey, apiSecret }),
  });
  await parseResponse(response);
}

export async function disconnectFudo(businessId: string) {
  const response = await fetch(`/api/integrations/fudo?businessId=${encodeURIComponent(businessId)}`, { method: 'DELETE', headers: await authHeaders() });
  await parseResponse(response);
}

export async function syncFudo(businessId: string, days = 90): Promise<FudoSyncResult> {
  const response = await fetch(`/api/integrations/fudo/sync?businessId=${encodeURIComponent(businessId)}`, {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ days }),
  });
  const body = await parseResponse(response);
  return {
    imported: Number(body.imported || 0),
    fromDate: String(body.fromDate || ''),
    cashKnown: Number(body.cashKnown || 0),
    salesTotal: Number(body.salesTotal || 0),
  };
}
