import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildCanonicalNotificationSnapshot } from '@/lib/push-canonical';
import { refreshFudoSalesForBusiness } from '@/lib/fudo-server';
import { sendPush, supabaseRest } from '@/lib/push-server';

export const runtime = 'nodejs';

const MIN_DAILY_CHANGE = 25_000;
const MIN_CHANGE_RATIO = 0.08;
const SUPABASE_SCHEDULER_TOKEN_SHA256 = '6d297bc71d99fe5d75afffdb62da3c0d430fd4349f6d32104205059b778d6c1d';

type DayException = { date: string; open: boolean };

function isAuthorizedSchedulerRequest(request: Request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;

  const schedulerToken = request.headers.get('x-lebu-scheduler-token');
  if (!schedulerToken) return false;
  const digest = crypto.createHash('sha256').update(schedulerToken).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(SUPABASE_SCHEDULER_TOKEN_SHA256, 'hex'));
  } catch {
    return false;
  }
}

function localClock(timezone: string, date = new Date()) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const weekdayLabel = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const get = (type: string) => dateParts.find((part) => part.type === type)?.value || '0';
  return {
    dateISO: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayLabel),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function parseISO(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addISODate(value: string, days: number) {
  const date = parseISO(value);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function dayExceptions(snapshot: any): DayException[] {
  return Array.isArray(snapshot?.dayExceptions)
    ? snapshot.dayExceptions.filter((item: any) => typeof item?.date === 'string' && typeof item?.open === 'boolean')
    : [];
}

function isOpenDate(dateISO: string, weekday: number, openWeekdays: number[], exceptions: DayException[]) {
  const exception = exceptions.find((item) => item.date === dateISO);
  if (exception) return exception.open;
  return openWeekdays.includes(weekday);
}

function listOpenDates(startISO: string, endISO: string, openWeekdays: number[], fromISO: string, exceptions: DayException[]) {
  const effectiveStart = startISO > fromISO ? startISO : fromISO;
  const start = parseISO(effectiveStart);
  const end = parseISO(endISO);
  const dates: { dateISO: string; weekday: number }[] = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
    const dateISO = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`;
    const weekday = cursor.getUTCDay();
    if (isOpenDate(dateISO, weekday, openWeekdays, exceptions)) dates.push({ dateISO, weekday });
  }
  return dates;
}

function countOpenDays(startISO: string, endISO: string, openWeekdays: number[], fromISO: string, exceptions: DayException[]) {
  return listOpenDates(startISO, endISO, openWeekdays, fromISO, exceptions).length;
}

function weightedTarget(snapshot: any, fromISO: string, exceptions: DayException[]) {
  const dates = listOpenDates(snapshot.periodStart, snapshot.periodEnd, snapshot.openWeekdays, fromISO, exceptions);
  const total = Math.max(Number(snapshot.additionalSalesNeeded || 0), 0);
  if (!dates.length || total <= 0) return { target: 0, remainingDays: dates.length };

  const smartActive = snapshot.smartDistributionActive === true;
  const weightByWeekday = snapshot.smartWeightByWeekday && typeof snapshot.smartWeightByWeekday === 'object' ? snapshot.smartWeightByWeekday : {};
  const weights = dates.map((item) => {
    if (!smartActive) return 1;
    const value = Number(weightByWeekday[item.weekday]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || dates.length;
  return { target: total * weights[0] / totalWeight, remainingDays: dates.length };
}

function money(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Math.round(value));
}

function significantDelta(previous: number, current: number) {
  const delta = Math.abs(current - previous);
  if (delta < MIN_DAILY_CHANGE) return false;
  if (previous <= 0) return true;
  return delta / previous >= MIN_CHANGE_RATIO;
}

async function patchSubscription(deviceId: string, patch: Record<string, unknown>) {
  return supabaseRest(`push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function removeDeadSubscription(deviceId: string) {
  await supabaseRest(`push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
}

export async function GET(request: Request) {
  if (!isAuthorizedSchedulerRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const subscriptionsResponse = await supabaseRest('push_subscriptions?notifications_enabled=eq.true&select=*');
    const statesResponse = await supabaseRest('notification_state?select=*');
    if (!subscriptionsResponse.ok || !statesResponse.ok) throw new Error('No se pudieron leer los datos de notificaciones.');
    const subscriptions = await subscriptionsResponse.json();
    const states = await statesResponse.json();
    const stateByDevice = new Map(states.map((row: any) => [row.device_id, row.snapshot]));
    let morningDue = 0;
    let morningSent = 0;
    let closingDue = 0;
    let closingSent = 0;

    for (const subscription of subscriptions) {
      let snapshot: any = stateByDevice.get(subscription.device_id);
      if (!snapshot) continue;

      const timezone = subscription.timezone || 'America/Argentina/Buenos_Aires';
      let now;
      try {
        now = localClock(timezone);
      } catch {
        now = localClock('America/Argentina/Buenos_Aires');
      }

      const morningMinutes = Number(subscription.morning_hour ?? 8) * 60 + Number(subscription.morning_minute ?? 0);
      const closingMinutes = Number(subscription.closing_hour ?? 20) * 60 + Number(subscription.closing_minute ?? 0);
      const morningPotential = subscription.morning_enabled !== false && now.minutes >= morningMinutes && subscription.last_morning_sent_date !== now.dateISO;
      const closingPotential = subscription.closing_enabled === true && now.minutes >= closingMinutes && subscription.last_closing_sent_date !== now.dateISO;
      if (!morningPotential && !closingPotential) continue;

      // 1.21.4: antes de decidir o enviar un aviso refrescamos desde la fuente canónica.
      // No intentamos despertar la PWA: el cron lee directamente ventas/gastos ya sincronizados
      // en Supabase. Si Cloud no puede refrescarse, preferimos omitir el aviso a mandar un número viejo.
      const snapshotBusinessId = snapshot.source === 'cloud-canonical-v1' && typeof snapshot.businessId === 'string' && snapshot.businessId
        ? snapshot.businessId
        : null;
      const subscriptionBusinessId = typeof subscription.business_id === 'string' && subscription.business_id
        ? subscription.business_id
        : null;
      const businessId = snapshotBusinessId || subscriptionBusinessId;

      // Las instalaciones antiguas pueden conservar un notification_state previo a Cloud v2.
      // La suscripción ya quedó vinculada al comercio al activar preferencias/notificaciones,
      // así que usamos ese vínculo para reconstruir un snapshot canónico en el servidor.
      if (!businessId) continue;

      try {
        // FUDO es una fuente operativa: refrescamos antes de calcular el push canónico.
        // Si no hay conexión, la función vuelve sin tocar nada. Si la conexión falla,
        // preferimos omitir el aviso antes que enviar un objetivo construido con ventas viejas.
        await refreshFudoSalesForBusiness(businessId, 14);
        snapshot = await buildCanonicalNotificationSnapshot(businessId, timezone);
        stateByDevice.set(subscription.device_id, snapshot);
        await supabaseRest('notification_state?on_conflict=device_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ device_id: subscription.device_id, snapshot, updated_at: new Date().toISOString() }),
        });
      } catch {
        continue;
      }

      if (!snapshot?.hasTarget || !snapshot?.periodStart || !snapshot?.periodEnd || !Array.isArray(snapshot.openWeekdays)) continue;
      if (now.dateISO < snapshot.periodStart || now.dateISO > snapshot.periodEnd) continue;
      const exceptions = dayExceptions(snapshot);
      const todayIsOpen = isOpenDate(now.dateISO, now.weekday, snapshot.openWeekdays, exceptions);
      if (!todayIsOpen) continue;

      // Aviso de arranque del día.
      if (morningPotential) {
        morningDue += 1;
        const weighted = weightedTarget(snapshot, now.dateISO, exceptions);
        const remainingDays = weighted.remainingDays;
        const additionalSalesNeeded = Number(snapshot.additionalSalesNeeded || 0);
        const canonicalReference = Number(snapshot.referenceDailyTarget);
        const dailyNeeded = snapshot.source === 'cloud-canonical-v1' && Number.isFinite(canonicalReference) && canonicalReference >= 0
          ? canonicalReference
          : weighted.target;
        const goalReached = Boolean(snapshot.goalReached) || additionalSalesNeeded <= 0;
        const previousDaily = Number(subscription.last_notified_daily_target);
        const hasPreviousDaily = Number.isFinite(previousDaily) && subscription.last_notified_daily_target !== null;

        let payload;
        const smartDistributionActive = snapshot.smartDistributionActive === true;
        if (goalReached) {
          payload = { title: 'Objetivo adentro 🦉', body: 'Arrancás el día sin correr de atrás. Seguí cargando movimientos y Lebu vigila el resto.', url: '/', tag: `lebu-morning-${now.dateISO}` };
        } else if (smartDistributionActive && hasPreviousDaily && significantDelta(previousDaily, dailyNeeded)) {
          const delta = dailyNeeded - previousDaily;
          payload = {
            title: `Hoy apuntá a ${money(dailyNeeded)}`,
            body: `Son ${money(Math.abs(delta))} ${delta < 0 ? 'menos' : 'más'} que el objetivo anterior. Lebu ya está repartiendo la meta según el peso habitual de cada día.`,
            url: '/',
            tag: `lebu-morning-${now.dateISO}`,
          };
        } else if (hasPreviousDaily && significantDelta(previousDaily, dailyNeeded) && dailyNeeded < previousDaily) {
          payload = { title: 'Buen día ayer 🦉', body: `Tu objetivo bajó de ${money(previousDaily)} a ${money(dailyNeeded)} por día. Venís arriba del ritmo.`, url: '/', tag: `lebu-morning-${now.dateISO}` };
        } else if (hasPreviousDaily && significantDelta(previousDaily, dailyNeeded) && dailyNeeded > previousDaily) {
          payload = { title: 'Hoy el ritmo subió', body: `Tu objetivo pasó de ${money(previousDaily)} a ${money(dailyNeeded)} por día. Lebu recalculó con tus últimos movimientos.`, url: '/', tag: `lebu-morning-${now.dateISO}` };
        } else {
          payload = { title: `Hoy apuntá a ${money(dailyNeeded)}`, body: smartDistributionActive ? `Te quedan ${remainingDays} días abiertos. Este número ya contempla cómo suele pesar este día en tu negocio.` : `Te quedan ${remainingDays} días abiertos en este objetivo. Ese es el número de hoy.`, url: '/', tag: `lebu-morning-${now.dateISO}` };
        }

        try {
          await sendPush(subscription, payload);
          morningSent += 1;
          await patchSubscription(subscription.device_id, { last_notified_daily_target: dailyNeeded, last_morning_sent_date: now.dateISO });
          // Reflejamos el valor nuevo en memoria por si cierre y arranque tienen horarios cercanos.
          subscription.last_notified_daily_target = dailyNeeded;
          subscription.last_morning_sent_date = now.dateISO;
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await removeDeadSubscription(subscription.device_id);
            continue;
          }
        }
      }

      // Resumen de cierre. Si no hay ninguna venta cargada para hoy, Lebu no interrumpe.
      if (closingPotential) {
        closingDue += 1;
        const salesByDate = snapshot.salesByDate && typeof snapshot.salesByDate === 'object' ? snapshot.salesByDate : {};
        const todaySales = Number(salesByDate[now.dateISO] || 0);
        if (!(todaySales > 0)) continue;

        const tomorrow = addISODate(now.dateISO, 1);
        const futureWeighted = tomorrow <= snapshot.periodEnd
          ? weightedTarget(snapshot, tomorrow, exceptions)
          : { target: 0, remainingDays: 0 };
        const futureOpenDays = futureWeighted.remainingDays;
        const additionalSalesNeeded = Number(snapshot.additionalSalesNeeded || 0);
        const nextDaily = futureWeighted.target;
        const goalReached = Boolean(snapshot.goalReached) || additionalSalesNeeded <= 0;
        const canonicalReference = Number(snapshot.referenceDailyTarget);
        const morningTarget = subscription.last_morning_sent_date === now.dateISO ? Number(subscription.last_notified_daily_target) : NaN;
        // El cierre se evalúa contra la misma referencia canónica que muestra Inicio.
        // El objetivo guardado por la mañana queda sólo como fallback de compatibilidad.
        const closingTarget = Number.isFinite(canonicalReference) && canonicalReference > 0
          ? canonicalReference
          : morningTarget;
        const hasClosingTarget = Number.isFinite(closingTarget) && closingTarget > 0;

        let title = 'Cierre de hoy';
        let body = `Vendiste ${money(todaySales)}.`;
        if (hasClosingTarget) {
          const delta = todaySales - closingTarget;
          if (delta >= 0) {
            title = 'Buen cierre 🦉';
            body = `Vendiste ${money(todaySales)}, ${money(delta)} arriba del objetivo de hoy.`;
          } else {
            body = `Vendiste ${money(todaySales)}. Hoy quedaste ${money(Math.abs(delta))} debajo del objetivo.`;
          }
        }

        if (goalReached) body += ' La meta del período ya está adentro.';
        else if (futureOpenDays > 0) body += ` Próximo día abierto: apuntá a ${money(nextDaily)}.`;
        else body += ' Ya no quedan más días abiertos en este período.';

        try {
          await sendPush(subscription, { title, body, url: '/', tag: `lebu-closing-${now.dateISO}` });
          closingSent += 1;
          await patchSubscription(subscription.device_id, { last_closing_sent_date: now.dateISO });
          subscription.last_closing_sent_date = now.dateISO;
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) await removeDeadSubscription(subscription.device_id);
        }
      }
    }

    return NextResponse.json({ ok: true, morningDue, morningSent, closingDue, closingSent });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 500 });
  }
}
