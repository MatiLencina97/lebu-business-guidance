import { NextResponse } from 'next/server';
import { getAuthorizedSubscription, supabaseRest } from '@/lib/push-server';

export const runtime = 'nodejs';

function timeFromParts(hourValue: unknown, minuteValue: unknown, fallbackHour: number) {
  const hour = Number(hourValue ?? fallbackHour);
  const minute = Number(minuteValue ?? 0);
  return `${String(Math.min(Math.max(hour, 0), 23)).padStart(2, '0')}:${String(Math.min(Math.max(minute, 0), 59)).padStart(2, '0')}`;
}

function parseTime(value: unknown) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function localDateAndMinutes(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '0';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export async function POST(request: Request) {
  try {
    const { deviceId, deviceSecret } = await request.json();
    if (!deviceId || !deviceSecret) return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });
    const subscription = await getAuthorizedSubscription(deviceId, deviceSecret);
    if (!subscription) return NextResponse.json({ error: 'Dispositivo no autorizado.' }, { status: 403 });
    return NextResponse.json({
      morningEnabled: subscription.morning_enabled !== false,
      smartChangesEnabled: subscription.smart_changes_enabled !== false,
      morningTime: timeFromParts(subscription.morning_hour, subscription.morning_minute, 8),
      closingEnabled: subscription.closing_enabled === true,
      closingTime: timeFromParts(subscription.closing_hour, subscription.closing_minute, 20),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { deviceId, deviceSecret, preferences } = await request.json();
    if (!deviceId || !deviceSecret || !preferences) return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });
    const subscription = await getAuthorizedSubscription(deviceId, deviceSecret);
    if (!subscription) return NextResponse.json({ error: 'Dispositivo no autorizado.' }, { status: 403 });

    const morningTime = parseTime(preferences.morningTime ?? timeFromParts(subscription.morning_hour, subscription.morning_minute, 8));
    const closingTime = parseTime(preferences.closingTime ?? timeFromParts(subscription.closing_hour, subscription.closing_minute, 20));
    if (!morningTime || !closingTime) return NextResponse.json({ error: 'El horario elegido no es válido.' }, { status: 400 });

    const timezone = subscription.timezone || 'America/Argentina/Buenos_Aires';
    const localNow = localDateAndMinutes(timezone);
    const morningMinutes = morningTime.hour * 60 + morningTime.minute;
    const closingMinutes = closingTime.hour * 60 + closingTime.minute;
    const morningTimeChanged = morningTime.hour !== Number(subscription.morning_hour ?? 8) || morningTime.minute !== Number(subscription.morning_minute ?? 0);
    const closingTimeChanged = closingTime.hour !== Number(subscription.closing_hour ?? 20) || closingTime.minute !== Number(subscription.closing_minute ?? 0);
    const closingWasEnabled = subscription.closing_enabled === true;
    const closingWillBeEnabled = preferences.closingEnabled === true;

    const patch: Record<string, unknown> = {
      morning_enabled: preferences.morningEnabled !== false,
      smart_changes_enabled: preferences.smartChangesEnabled !== false,
      morning_hour: morningTime.hour,
      morning_minute: morningTime.minute,
      closing_enabled: closingWillBeEnabled,
      closing_hour: closingTime.hour,
      closing_minute: closingTime.minute,
      updated_at: new Date().toISOString(),
    };

    // Si el usuario elige para hoy una hora que ya pasó, no mandamos un push atrasado inmediatamente.
    if (morningTimeChanged && localNow.minutes >= morningMinutes) patch.last_morning_sent_date = localNow.date;
    if ((closingTimeChanged || (!closingWasEnabled && closingWillBeEnabled)) && localNow.minutes >= closingMinutes) patch.last_closing_sent_date = localNow.date;

    const response = await supabaseRest(`push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return NextResponse.json({ error: 'No se pudieron guardar las preferencias.' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 500 });
  }
}
