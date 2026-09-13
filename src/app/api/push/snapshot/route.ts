import { NextResponse } from 'next/server';
import { buildCanonicalNotificationSnapshot } from '@/lib/push-canonical';
import { getAuthorizedSubscription, requireBusinessAccess, sendPush, supabaseRest } from '@/lib/push-server';

export const runtime = 'nodejs';

const SMART_COOLDOWN_MS = 15 * 60 * 1000;
const MIN_DAILY_CHANGE = 25_000;
const MIN_CHANGE_RATIO = 0.08;

function money(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Math.round(value));
}

function dailyTarget(snapshot: any) {
  const explicit = Number(snapshot?.dailyNeeded);
  if (Number.isFinite(explicit)) return Math.max(explicit, 0);
  const remainingDays = Number(snapshot?.remainingOpenDays || 0);
  const additional = Number(snapshot?.additionalSalesNeeded || 0);
  return remainingDays > 0 ? Math.max(additional / remainingDays, 0) : 0;
}

function isSignificantIncrease(previous: number, current: number) {
  const delta = current - previous;
  if (delta < MIN_DAILY_CHANGE) return false;
  if (previous <= 0) return true;
  return delta / previous >= MIN_CHANGE_RATIO;
}

function smartPayload(previous: any, current: any, event: any) {
  if (!previous || !event) return null;

  const wasReached = Boolean(previous.goalReached);
  const isReached = Boolean(current.goalReached);
  if (!wasReached && isReached && event.kind === 'sale_added') {
    return {
      title: 'Objetivo cumplido 🦉',
      body: `Llegaste a la meta. Tu ganancia estimada ya está en ${money(Number(current.currentProfit || 0))}.`,
      url: '/',
      tag: `lebu-goal-${current.periodEnd || 'current'}`,
      priority: 'goal',
    };
  }

  if (event.kind !== 'expense_added') return null;

  const before = dailyTarget(previous);
  const after = dailyTarget(current);
  if (wasReached && !isReached && after > 0) {
    return {
      title: 'El objetivo volvió a moverse',
      body: `Ese gasto reabrió la meta: ahora apuntá a ${money(after)} por día.`,
      url: '/',
      tag: `lebu-expense-${event.id}`,
      priority: 'expense',
    };
  }
  if (!isSignificantIncrease(before, after)) return null;

  const delta = after - before;
  const category = typeof event.category === 'string' && event.category.trim() ? `${event.category.trim()}: ` : '';
  const amount = Number(event.amount || 0);
  const expenseCopy = amount > 0 ? `${category}${money(amount)}. ` : '';
  return {
    title: 'Ese gasto movió el objetivo',
    body: `${expenseCopy}Ahora necesitás ${money(after)} por día, ${money(delta)} más que antes.`,
    url: '/',
    tag: `lebu-expense-${event.id}`,
    priority: 'expense',
  };
}

export async function POST(request: Request) {
  try {
    const { deviceId, deviceSecret, snapshot, event } = await request.json();
    if (!deviceId || !deviceSecret || !snapshot) return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });
    const subscription = await getAuthorizedSubscription(deviceId, deviceSecret);
    if (!subscription) return NextResponse.json({ error: 'Dispositivo no autorizado.' }, { status: 403 });

    const businessId = typeof snapshot.businessId === 'string' && snapshot.businessId ? snapshot.businessId : null;
    let currentSnapshot = snapshot;
    let canonical = false;

    if (businessId) {
      const access = await requireBusinessAccess(request, businessId);
      if (!access) return NextResponse.json({ error: 'No tenés acceso a ese comercio.' }, { status: 403 });
      // La fuente autoritativa es Cloud. El snapshot del navegador sólo identifica el comercio
      // y aporta el evento que disparó la revisión; los números se reconstruyen en el servidor.
      currentSnapshot = await buildCanonicalNotificationSnapshot(
        businessId,
        subscription.timezone || 'America/Argentina/Buenos_Aires',
      );
      canonical = true;
    }

    const previousResponse = await supabaseRest(`notification_state?device_id=eq.${encodeURIComponent(deviceId)}&select=snapshot&limit=1`);
    const previousRows = previousResponse.ok ? await previousResponse.json() : [];
    const previousSnapshot = previousRows?.[0]?.snapshot || null;

    const response = await supabaseRest('notification_state?on_conflict=device_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ device_id: deviceId, snapshot: currentSnapshot, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) return NextResponse.json({ error: 'No se pudo actualizar el estado.' }, { status: 500 });

    let smartSent = false;
    // En el primer salto desde un snapshot viejo a uno canónico sólo sembramos la nueva base.
    // Evita una notificación falsa causada por comparar dos motores/versiones diferentes.
    const comparablePrevious = !canonical || previousSnapshot?.source === 'cloud-canonical-v1'
      ? previousSnapshot
      : null;
    const payload = subscription.smart_changes_enabled !== false ? smartPayload(comparablePrevious, currentSnapshot, event) : null;
    const lastSmartAt = subscription.last_smart_notified_at ? Date.parse(subscription.last_smart_notified_at) : 0;
    const cooldownPassed = !lastSmartAt || Date.now() - lastSmartAt >= SMART_COOLDOWN_MS;
    const canSend = payload && (payload.priority === 'goal' || cooldownPassed);

    if (canSend) {
      try {
        await sendPush(subscription, payload);
        smartSent = true;
        await supabaseRest(`push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ last_smart_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
        });
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await supabaseRest(`push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
        }
      }
    }

    return NextResponse.json({ ok: true, smartSent, source: canonical ? 'cloud' : 'legacy' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 500 });
  }
}
