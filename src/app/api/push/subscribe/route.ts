import { NextResponse } from 'next/server';
import { getAuthorizedSubscription, hashDeviceSecret, supabaseRest } from '@/lib/push-server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { deviceId, deviceSecret, subscription, timezone } = body || {};
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (!deviceId || !deviceSecret || !endpoint || !p256dh || !auth) return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });

    const existingResponse = await supabaseRest(`push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}&select=device_id,device_secret_hash`);
    const existingRows = existingResponse.ok ? await existingResponse.json() : [];
    const existing = existingRows?.[0];
    const secretHash = hashDeviceSecret(deviceSecret);
    if (existing?.device_secret_hash && existing.device_secret_hash !== secretHash) return NextResponse.json({ error: 'Dispositivo no autorizado.' }, { status: 403 });

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
