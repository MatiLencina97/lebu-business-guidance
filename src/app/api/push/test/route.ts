import { NextResponse } from 'next/server';
import { getAuthorizedSubscription, sendPush } from '@/lib/push-server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { deviceId, deviceSecret } = await request.json();
    const subscription = await getAuthorizedSubscription(deviceId, deviceSecret);
    if (!subscription) return NextResponse.json({ error: 'Activá primero las notificaciones en este dispositivo.' }, { status: 403 });
    await sendPush(subscription, {
      title: 'Lebu está atento 🦉',
      body: 'Listo. Este iPhone ya puede recibir tus avisos de ritmo.',
      url: '/',
      tag: 'lebu-test',
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'No se pudo enviar la prueba.' }, { status: 500 });
  }
}
