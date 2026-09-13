import { NextResponse } from 'next/server';
import { requireBusinessAccess } from '../../../../lib/push-server';
import {
  authenticateFudo,
  deleteFudoConnection,
  loadFudoConnection,
  saveFudoConnection,
} from '../../../../lib/fudo-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function businessFromRequest(request: Request) {
  const url = new URL(request.url);
  const businessId = String(url.searchParams.get('businessId') || '').trim();
  if (!businessId) return { error: jsonError('Falta businessId.') } as const;
  const access = await requireBusinessAccess(request, businessId);
  if (!access) return { error: jsonError('No tenés acceso a este negocio.', 403) } as const;
  return { businessId, access } as const;
}

export async function GET(request: Request) {
  try {
    const resolved = await businessFromRequest(request);
    if ('error' in resolved) return resolved.error;
    const row = await loadFudoConnection(resolved.businessId);
    return NextResponse.json({
      ok: true,
      connected: Boolean(row && row.status !== 'disconnected'),
      status: row?.status || 'disconnected',
      lastSyncAt: row?.last_sync_at || null,
      lastError: row?.last_error || null,
      lastSyncSalesCount: Number(row?.last_sync_sales_count || 0),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'No se pudo consultar FUDO.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const resolved = await businessFromRequest(request);
    if ('error' in resolved) return resolved.error;
    if (!['owner', 'admin'].includes(resolved.access.role)) return jsonError('Solo dueño o administrador puede conectar FUDO.', 403);
    const body = await request.json().catch(() => ({}));
    const apiKey = String(body?.apiKey || '').trim();
    const apiSecret = String(body?.apiSecret || '').trim();
    if (!apiKey || !apiSecret) return jsonError('Ingresá API Key y API Secret de FUDO.');

    // Probamos antes de persistir: una clave inválida nunca queda guardada.
    const auth = await authenticateFudo({ apiKey, apiSecret });
    await saveFudoConnection(resolved.businessId, resolved.access.userId, { apiKey, apiSecret }, auth.token, auth.expiresAt);
    return NextResponse.json({ ok: true, connected: true, status: 'connected' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'No se pudo conectar FUDO.', 502);
  }
}

export async function DELETE(request: Request) {
  try {
    const resolved = await businessFromRequest(request);
    if ('error' in resolved) return resolved.error;
    if (!['owner', 'admin'].includes(resolved.access.role)) return jsonError('Solo dueño o administrador puede desconectar FUDO.', 403);
    await deleteFudoConnection(resolved.businessId);
    return NextResponse.json({ ok: true, connected: false, status: 'disconnected' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'No se pudo desconectar FUDO.', 500);
  }
}
