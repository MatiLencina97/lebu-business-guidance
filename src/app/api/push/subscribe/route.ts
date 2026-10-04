import { NextResponse } from 'next/server';
import { getAuthorizedSubscription, hashDeviceSecret, requireBusinessAccess, supabaseRest } from '@/lib/push-server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { deviceId, deviceSecret, businessId, subscription, timezone } = body || {};
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (!deviceId || !deviceSecret || !endpoint || !p256dh || !auth) return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });

    if (businessId) {
      const access = await requireBusinessAccess(request, String(businessId));
      if (!access) return NextResponse.json({ error: 'No tenés acceso a ese comercio.' }, { status: 403 });
    }

    const existingResponse = await supabaseRest(`push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}&select=*`);
    const existingRows = existingResponse.ok ? await existingResponse.json() : [];
    const existing = existingRows?.[0];
    const secretHash = hashDeviceSecret(deviceSecret);
    if (existing?.device_secret_hash && existing.device_secret_hash !== secretHash) return NextResponse.json({ error: 'Dispositivo no autorizado.' }, { status: 403 });

    let sharedPreferences: Record<string, unknown> = {};
    if (businessId) {
      const sharedResponse = await supabaseRest(
        `push_subscriptions?business_id=eq.${encodeURIComponent(String(businessId))}&device_id=neq.${encodeURIComponent(deviceId)}&select=morning_enabled,morning_hour,morning_minute,smart_changes_enabled,closing_enabled,closing_hour,closing_minute&order=updated_at.desc&limit=1`,
      );
      const rows = sharedResponse.ok ? await sharedResponse.json() : [];
      const source = rows?.[0];
      if (source) {
        sharedPreferences = {
          morning_enabled: source.morning_enabled !== false,
          morning_hour: Number(source.morning_hour ?? 8),
          morning_minute: Number(source.morning_minute ?? 0),
          smart_changes_enabled: source.smart_changes_enabled !== false,
          closing_enabled: source.closing_enabled === true,
          closing_hour: Number(source.closing_hour ?? 20),
          closing_minute: Number(source.closing_minute ?? 0),
        };
      }
    }

    const upsert = await supabaseRest('push_subscriptions?on_conflict=device_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        device_id: deviceId,
        device_secret_hash: secretHash,
        endpoint,
        p256dh,
        auth,
        timezone: typeof timezone === 'string' && timezone.length < 80 ? timezone : 'America/Argentina/Buenos_Aires',
        notifications_enabled: true,
        business_id: businessId ? String(businessId) : existing?.business_id || null,
        ...sharedPreferences,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!upsert.ok) return NextResponse.json({ error: 'No se pudo guardar la suscripción.' }, { status: 500 });

    // Hace explícita la validación del secreto para futuras llamadas.
    await getAuthorizedSubscription(deviceId, deviceSecret);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 500 });
  }
}
