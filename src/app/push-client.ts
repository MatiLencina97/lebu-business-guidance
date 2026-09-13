import { supabase } from './cloud-sync';

export type PushSupportStatus = 'unsupported' | 'default' | 'enabled' | 'denied';

export type PushPreferences = {
  morningEnabled: boolean;
  smartChangesEnabled: boolean;
  morningTime: string;
  closingEnabled: boolean;
  closingTime: string;
};

export type SmartSyncEvent = {
  id: string;
  kind: 'sale_added' | 'expense_added' | 'movement_removed' | 'movement_edited' | 'settings_changed' | 'backup_imported';
  amount?: number;
  category?: string;
  occurredAt: string;
};

const DEVICE_ID_KEY = 'lebu-push-device-id';
const DEVICE_SECRET_KEY = 'lebu-push-device-secret';

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getPushDeviceIdentity() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  let deviceSecret = localStorage.getItem(DEVICE_SECRET_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  if (!deviceSecret) {
    deviceSecret = randomSecret();
    localStorage.setItem(DEVICE_SECRET_KEY, deviceSecret);
  }
  return { deviceId, deviceSecret };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

export function getPushSupportStatus(): PushSupportStatus {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'enabled' : 'default';
}

export async function enablePushNotifications() {
  if (getPushSupportStatus() === 'unsupported') throw new Error('Este dispositivo no soporta notificaciones web.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Las notificaciones están bloqueadas en iOS.' : 'No se habilitaron las notificaciones.');

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    const keyResponse = await fetch('/api/push/public-key', { cache: 'no-store' });
    if (!keyResponse.ok) throw new Error('Lebu todavía no tiene configurada la clave de notificaciones.');
    const { publicKey } = await keyResponse.json();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const identity = getPushDeviceIdentity();
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...identity,
      subscription: subscription.toJSON(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Argentina/Buenos_Aires',
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo registrar este iPhone para recibir notificaciones.');
  }

  return true;
}

export async function sendPushSnapshot(snapshot: Record<string, unknown>, event?: SmartSyncEvent | null) {
  if (Notification.permission !== 'granted' || !navigator.onLine) return false;
  const identity = getPushDeviceIdentity();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (typeof snapshot.businessId === 'string' && snapshot.businessId) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return false;
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch('/api/push/snapshot', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...identity, snapshot, event: event || null }),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getPushPreferences(): Promise<PushPreferences> {
  const identity = getPushDeviceIdentity();
  const response = await fetch('/api/push/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(identity),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudieron leer las preferencias de notificaciones.');
  return {
    morningEnabled: data.morningEnabled !== false,
    smartChangesEnabled: data.smartChangesEnabled !== false,
    morningTime: typeof data.morningTime === 'string' ? data.morningTime : '08:00',
    closingEnabled: data.closingEnabled === true,
    closingTime: typeof data.closingTime === 'string' ? data.closingTime : '20:00',
  };
}

export async function savePushPreferences(preferences: PushPreferences) {
  const identity = getPushDeviceIdentity();
  const response = await fetch('/api/push/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...identity, preferences }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudieron guardar las preferencias.');
}

export async function sendTestPush() {
  const identity = getPushDeviceIdentity();
  const response = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(identity),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo enviar la notificación de prueba.');
}
