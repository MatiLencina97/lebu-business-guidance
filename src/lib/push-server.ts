import crypto from 'node:crypto';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let authVerifier: ReturnType<typeof createClient> | null = null;

function authClient() {
  requireServerConfig();
  if (!authVerifier) {
    authVerifier = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return authVerifier;
}

export async function requireBusinessAccess(request: Request, businessId: string) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return null;

  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data.user) return null;

  const response = await supabaseRest(
    `business_members?business_id=eq.${encodeURIComponent(businessId)}&user_id=eq.${encodeURIComponent(data.user.id)}&select=role&limit=1`,
  );
  if (!response.ok) throw new Error('No se pudo validar el acceso al comercio.');
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]) return null;
  return { userId: data.user.id, role: String(rows[0].role || '') };
}

export function requireServerConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Falta configurar Supabase en Vercel.');
}

export function hashDeviceSecret(secret: string) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export async function supabaseRest(path: string, init: RequestInit = {}) {
  requireServerConfig();
  const headers = new Headers(init.headers);
  headers.set('apikey', SUPABASE_SERVICE_ROLE_KEY!);
  headers.set('Authorization', `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
}

export function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!publicKey || !privateKey) throw new Error('Faltan las claves VAPID de Lebu.');
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function getAuthorizedSubscription(deviceId: string, deviceSecret: string) {
  const response = await supabaseRest(`push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}&select=*`);
  if (!response.ok) throw new Error('No se pudo consultar la suscripción.');
  const rows = await response.json();
  const row = rows?.[0];
  if (!row || !row.device_secret_hash || row.device_secret_hash !== hashDeviceSecret(deviceSecret)) return null;
  return row;
}

export async function sendPush(row: any, payload: Record<string, unknown>) {
  configureWebPush();
  return webpush.sendNotification({
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }, JSON.stringify(payload));
}
