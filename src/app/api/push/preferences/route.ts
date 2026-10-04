import { NextResponse } from 'next/server';
import { getAuthorizedSubscription, requireBusinessAccess, supabaseRest } from '@/lib/push-server';

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

async function bindBusiness(request: Request, subscription: any, businessId: unknown) {
  if (!businessId) return { subscription, shared: subscription, businessId: null as string | null };
  const id = String(businessId);
  const access = await requireBusinessAccess(request, id);
  if (!access) return null;

  if (subscription.business_id !== id) {
    const bindResponse = await supabaseRest(`push_subscriptions?device_id=eq.${encodeURIComponent(subscription.device_id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ business_id: id, updated_at: new Date().toISOString() }),
    });
    if (!bindResponse.ok) throw new Error('No se pudo asociar este dispositivo al comercio.');
  }

  const sharedResponse = await supabaseRest(
    `push_subscriptions?business_id=eq.${encodeURIComponent(id)}&select=*&order=updated_at.desc&limit=1`,
  );
  const rows = sharedResponse.ok ? await sharedResponse.json() : [];
  return { subscription: { ...subscription, business_id: id }, shared: rows?.[0] || subscription, businessId: id };
}

export async function POST(request: Request) {
  try {
    const { deviceId, deviceSecret, businessId } = await request.json();
    if (!deviceId || !deviceSecret) return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });
    const subscription = await getAuthorizedSubscription(deviceId, deviceSecret);
    if (!subscription) return NextResponse.json({ error: 'Dispositivo no autorizado.' }, { status: 403 });
    const context = await bindBusiness(request, subscription, businessId);
    if (!context) return NextResponse.json({ error: 'No tenés acceso a ese comercio.' }, { status: 403 });
    const source = context.shared;
    return NextResponse.json({
      morningEnabled: source.morning_enabled !== false,
      smartChangesEnabled: source.smart_changes_enabled !== false,
      morningTime: timeFromParts(source.morning_hour, source.morning_minute, 8),
      closingEnabled: source.closing_enabled === true,
      closingTime: timeFromParts(source.closing_hour, source.closing_minute, 20),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { deviceId, deviceSecret, businessId, preferences } = await request.json();
    if (!deviceId || !deviceSecret || !preferences) return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });
    const subscription = await getAuthorizedSubscription(deviceId, deviceSecret);
    if (!subscription) return NextResponse.json({ error: 'Dispositivo no autorizado.' }, { status: 403 });
    const context = await bindBusiness(request, subscription, businessId);
    if (!context) return NextResponse.json({ error: 'No tenés acceso a ese comercio.' }, { status: 403 });

    const source = context.shared;
    const morningTime = parseTime(preferences.morningTime ?? timeFromParts(source.morning_hour, source.morning_minute, 8));
    const closingTime = parseTime(preferences.closingTime ?? timeFromParts(source.closing_hour, source.closing_minute, 20));
    if (!morningTime || !closingTime) return NextResponse.json({ error: 'El horario elegido no es válido.' }, { status: 400 });

    const timezone = subscription.timezone || 'America/Argentina/Buenos_Aires';
    const localNow = localDateAndMinutes(timezone);
    const morningMinutes = morningTime.hour * 60 + morningTime.minute;
    const closingMinutes = closingTime.hour * 60 + closingTime.minute;
    const morningTimeChanged = morningTime.hour !== Number(source.morning_hour ?? 8) || morningTime.minute !== Number(source.morning_minute ?? 0);
    const closingTimeChanged = closingTime.hour !== Number(source.closing_hour ?? 20) || closingTime.minute !== Number(source.closing_minute ?? 0);
    const closingWasEnabled = source.closing_enabled === true;
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

    if (morningTimeChanged && localNow.minutes >= morningMinutes) patch.last_morning_sent_date = localNow.date;
    if ((closingTimeChanged || (!closingWasEnabled && closingWillBeEnabled)) && localNow.minutes >= closingMinutes) patch.last_closing_sent_date = localNow.date;

    const path = context.businessId
      ? `push_subscriptions?business_id=eq.${encodeURIComponent(context.businessId)}`
      : `push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}`;
    const response = await supabaseRest(path, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return NextResponse.json({ error: 'No se pudieron guardar las preferencias.' }, { status: 500 });
    return NextResponse.json({ ok: true, scope: context.businessId ? 'business' : 'device' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 500 });
  }
}
