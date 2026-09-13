import { NextResponse } from 'next/server';
import { requireBusinessAccess } from '../../../../../lib/push-server';
import { fetchFudoSales, loadFudoConnection, markFudoSyncResult, upsertFudoSales } from '../../../../../lib/fudo-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  let businessId = '';
  try {
    const url = new URL(request.url);
    businessId = String(url.searchParams.get('businessId') || '').trim();
    if (!businessId) return jsonError('Falta businessId.');
    const access = await requireBusinessAccess(request, businessId);
    if (!access) return jsonError('No tenés acceso a este negocio.', 403);
    if (!['owner', 'admin'].includes(access.role)) return jsonError('Solo dueño o administrador puede sincronizar FUDO.', 403);

    const body = await request.json().catch(() => ({}));
    const requestedDays = Number(body?.days || 90);
    const days = Math.min(Math.max(Number.isFinite(requestedDays) ? Math.round(requestedDays) : 90, 1), 730);
    const fromDate = String(body?.fromDate || dateDaysAgo(days)).slice(0, 10);
    const connection = await loadFudoConnection(businessId);
    if (!connection || connection.status === 'disconnected') return jsonError('FUDO todavía no está conectado.', 409);

    const sales = await fetchFudoSales(connection, fromDate);
    const imported = await upsertFudoSales(businessId, sales);
    await markFudoSyncResult(businessId, imported);
    return NextResponse.json({
      ok: true,
      imported,
      fromDate,
      cashKnown: sales.reduce((sum, sale) => sum + sale.cashAmount, 0),
      salesTotal: sales.filter((sale) => !sale.deleted).reduce((sum, sale) => sum + sale.amount, 0),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo sincronizar FUDO.';
    if (businessId) await markFudoSyncResult(businessId, 0, message).catch(() => undefined);
    return jsonError(message, 502);
  }
}
