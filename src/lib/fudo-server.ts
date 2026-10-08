import crypto from 'node:crypto';
import { supabaseRest } from './push-server';

const AUTH_BASE = (process.env.FUDO_AUTH_BASE_URL || 'https://auth.fu.do/api').replace(/\/$/, '');
const API_BASE = (process.env.FUDO_API_BASE_URL || 'https://api.fu.do/v1alpha1').replace(/\/$/, '');
const AUTH_PATH = process.env.FUDO_AUTH_PATH || '/login';
const SALES_PATH = process.env.FUDO_SALES_PATH || '/sales';
const SALES_INCLUDE = process.env.FUDO_SALES_INCLUDE || 'payments,payments.paymentMethod,items,items.product';
const SALES_FALLBACK_INCLUDE = process.env.FUDO_SALES_FALLBACK_INCLUDE || 'payments,payments.paymentMethod';
const PAGE_SIZE = 500;

type FudoCredentials = { apiKey: string; apiSecret: string };
type FudoConnectionRow = {
  business_id: string;
  api_key_ciphertext: string;
  api_secret_ciphertext: string;
  access_token_ciphertext?: string | null;
  access_token_expires_at?: string | null;
  status?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
  last_sync_sales_count?: number | null;
};

export type NormalizedFudoPayment = {
  id: string;
  amount: number;
  methodId?: string;
  methodName: string;
  methodType?: string;
  isCash: boolean;
};

export type NormalizedFudoSaleItem = {
  name: string;
  quantity: number;
  amount?: number;
  category?: string;
};

export type NormalizedFudoSale = {
  externalId: string;
  date: string;
  occurredAt?: string;
  amount: number;
  status: string;
  sourceUpdatedAt?: string;
  payments: NormalizedFudoPayment[];
  items: NormalizedFudoSaleItem[];
  cashAmount: number;
  deleted: boolean;
  metadata: Record<string, unknown>;
};

function encryptionKey() {
  const raw = (process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('Falta FUDO_CREDENTIALS_ENCRYPTION_KEY en el servidor.');
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try { key = Buffer.from(raw, 'base64'); } catch { key = Buffer.alloc(0); }
  }
  if (key.length !== 32) throw new Error('FUDO_CREDENTIALS_ENCRYPTION_KEY debe tener 32 bytes (base64) o 64 caracteres hex.');
  return key;
}

export function encryptFudoSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptFudoSecret(payload: string) {
  const [version, ivText, tagText, encryptedText] = String(payload || '').split('.');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) throw new Error('Credencial FUDO cifrada inválida.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

function jsonHeaders(token?: string) {
  const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

async function responseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; }
}

function errorMessage(body: any, fallback: string) {
  return String(body?.message || body?.error_description || body?.error || body?.errors?.[0]?.detail || fallback);
}

export async function authenticateFudo(credentials: FudoCredentials) {
  const response = await fetch(`${AUTH_BASE}${AUTH_PATH}`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ apiKey: credentials.apiKey, apiSecret: credentials.apiSecret }),
    cache: 'no-store',
  });
  const body = await responseJson(response);
  if (!response.ok) throw new Error(`FUDO rechazó las credenciales: ${errorMessage(body, `HTTP ${response.status}`)}`);
  const token = String(body?.token || body?.accessToken || body?.access_token || body?.data?.token || body?.data?.accessToken || '').trim();
  if (!token) throw new Error('FUDO autenticó la solicitud pero no devolvió un token reconocible.');
  const expiresIn = Number(body?.expiresIn || body?.expires_in || body?.data?.expiresIn || 24 * 60 * 60);
  const expiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) && expiresIn > 60 ? expiresIn : 24 * 60 * 60) * 1000).toISOString();
  return { token, expiresAt };
}

export async function loadFudoConnection(businessId: string): Promise<FudoConnectionRow | null> {
  const response = await supabaseRest(`business_fudo_connections?business_id=eq.${encodeURIComponent(businessId)}&select=*&limit=1`);
  if (!response.ok) throw new Error('No se pudo leer la conexión con FUDO.');
  const rows = await response.json();
  return Array.isArray(rows) && rows[0] ? rows[0] as FudoConnectionRow : null;
}

export async function saveFudoConnection(businessId: string, userId: string, credentials: FudoCredentials, token: string, expiresAt: string) {
  const response = await supabaseRest('business_fudo_connections?on_conflict=business_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      business_id: businessId,
      api_key_ciphertext: encryptFudoSecret(credentials.apiKey),
      api_secret_ciphertext: encryptFudoSecret(credentials.apiSecret),
      access_token_ciphertext: encryptFudoSecret(token),
      access_token_expires_at: expiresAt,
      status: 'connected',
      last_error: null,
      created_by: userId,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error('No se pudo guardar la conexión con FUDO.');
}

export async function deleteFudoConnection(businessId: string) {
  const response = await supabaseRest(`business_fudo_connections?business_id=eq.${encodeURIComponent(businessId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('No se pudo desconectar FUDO.');
}

async function getFudoAccessToken(connection: FudoConnectionRow) {
  const expiry = connection.access_token_expires_at ? Date.parse(connection.access_token_expires_at) : 0;
  if (connection.access_token_ciphertext && expiry > Date.now() + 5 * 60 * 1000) {
    return { token: decryptFudoSecret(connection.access_token_ciphertext), expiresAt: connection.access_token_expires_at! };
  }
  const credentials = {
    apiKey: decryptFudoSecret(connection.api_key_ciphertext),
    apiSecret: decryptFudoSecret(connection.api_secret_ciphertext),
  };
  const fresh = await authenticateFudo(credentials);
  const response = await supabaseRest(`business_fudo_connections?business_id=eq.${encodeURIComponent(connection.business_id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      access_token_ciphertext: encryptFudoSecret(fresh.token),
      access_token_expires_at: fresh.expiresAt,
      status: 'connected',
      last_error: null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error('FUDO autenticó, pero Lebu no pudo renovar el token guardado.');
  return fresh;
}

function unwrapAttributes(item: any) {
  return item && typeof item === 'object' && item.attributes && typeof item.attributes === 'object'
    ? { ...item.attributes, id: item.id ?? item.attributes.id, relationships: item.relationships }
    : (item || {});
}

function asFiniteNumber(value: unknown) {
  if (typeof value === 'string') value = value.replace(',', '.').replace(/[^0-9.-]/g, '');
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asDateOnly(value: unknown) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
}

function includedMap(body: any) {
  const map = new Map<string, any>();
  const included = Array.isArray(body?.included) ? body.included : [];
  for (const item of included) {
    if (!item?.id) continue;
    map.set(`${String(item.type || '')}:${String(item.id)}`, item);
    map.set(String(item.id), item);
  }
  return map;
}

function relationItems(entity: any, relationshipName: string, included: Map<string, any>) {
  const raw = entity?.relationships?.[relationshipName]?.data;
  const links = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return links.map((link: any) => included.get(`${String(link?.type || '')}:${String(link?.id || '')}`) || included.get(String(link?.id || ''))).filter(Boolean);
}

function paymentMethodFor(paymentEntity: any, included: Map<string, any>) {
  const relations = ['paymentMethod', 'payment_method', 'method'];
  for (const name of relations) {
    const item = relationItems(paymentEntity, name, included)[0];
    if (item) return unwrapAttributes(item);
  }
  const p = unwrapAttributes(paymentEntity);
  return p.paymentMethod || p.payment_method || p.method || null;
}

function isCashMethod(method: any) {
  const joined = [method?.name, method?.label, method?.type, method?.kind, method?.code]
    .map((value) => String(value || '').toLocaleLowerCase('es-AR'))
    .join(' ');
  return /\befectivo\b|\bcash\b/.test(joined);
}

function normalizePayments(saleEntity: any, body: any) {
  const included = includedMap(body);
  const relation = relationItems(saleEntity, 'payments', included);
  const direct = unwrapAttributes(saleEntity).payments;
  const candidates = relation.length ? relation : Array.isArray(direct) ? direct : [];
  return candidates.map((raw: any, index: number): NormalizedFudoPayment => {
    const payment = unwrapAttributes(raw);
    const method = paymentMethodFor(raw, included) || payment.paymentMethod || payment.payment_method || {};
    const methodName = String(method?.name || method?.label || method?.type || 'Medio de pago');
    return {
      id: String(raw?.id || payment?.id || index),
      amount: asFiniteNumber(payment.amount ?? payment.total ?? payment.value),
      methodId: method?.id ? String(method.id) : undefined,
      methodName,
      methodType: method?.type ? String(method.type) : undefined,
      isCash: isCashMethod(method),
    };
  }).filter((payment: NormalizedFudoPayment) => payment.amount > 0);
}

function normalizeSaleItems(saleEntity: any, body: any): NormalizedFudoSaleItem[] {
  const included = includedMap(body);
  const relationNames = ['items', 'additions', 'adiciones', 'saleItems', 'sale_items', 'lines'];
  let candidates: any[] = [];
  for (const name of relationNames) {
    const related = relationItems(saleEntity, name, included);
    if (related.length) {
      candidates = related;
      break;
    }
  }

  if (!candidates.length) {
    const direct = unwrapAttributes(saleEntity);
    for (const name of relationNames) {
      const value = direct?.[name];
      if (Array.isArray(value) && value.length) {
        candidates = value;
        break;
      }
    }
  }

  const result: NormalizedFudoSaleItem[] = [];
  for (const raw of candidates) {
    const item = unwrapAttributes(raw);
    let product: any = null;
    for (const relationName of ['product', 'item', 'menuItem', 'menu_item']) {
      const related = relationItems(raw, relationName, included)[0];
      if (related) {
        product = unwrapAttributes(related);
        break;
      }
    }
    product ||= item?.product || item?.menuItem || item?.menu_item || {};

    const name = String(
      product?.name || product?.label || item?.productName || item?.product_name
      || item?.name || item?.description || ''
    ).trim();
    if (!name) continue;

    const quantity = Math.max(asFiniteNumber(item?.quantity ?? item?.qty ?? item?.count ?? 1), 0);
    if (!(quantity > 0)) continue;
    const amount = asFiniteNumber(item?.total ?? item?.amount ?? item?.subtotal ?? item?.price);
    const category = String(
      product?.category?.name || product?.categoryName || item?.category?.name
      || item?.categoryName || item?.category || ''
    ).trim();

    result.push({
      name,
      quantity,
      ...(amount > 0 ? { amount } : {}),
      ...(category ? { category } : {}),
    });
  }
  return result;
}

export function normalizeFudoSale(raw: any, responseBody: any): NormalizedFudoSale | null {
  const sale = unwrapAttributes(raw);
  const externalId = String(raw?.id ?? sale?.id ?? '').trim();
  if (!externalId) return null;
  const occurredAtRaw = sale.closedAt ?? sale.closed_at ?? sale.date ?? sale.saleDate ?? sale.createdAt ?? sale.created_at;
  const occurredAtText = String(occurredAtRaw || '').trim();
  const occurredAt = occurredAtText && !Number.isNaN(Date.parse(occurredAtText)) ? new Date(occurredAtText).toISOString() : undefined;
  const date = asDateOnly(occurredAtRaw);
  if (!date) return null;
  const amount = asFiniteNumber(sale.total ?? sale.totalAmount ?? sale.total_amount ?? sale.amount ?? sale.grossAmount ?? sale.gross_amount);
  if (!(amount > 0)) return null;
  const status = String(sale.status ?? sale.state ?? '').trim();
  const lowered = status.toLocaleLowerCase('es-AR');
  const deleted = /cancel|void|anulad|refund|revers/.test(lowered);
  const payments = normalizePayments(raw, responseBody);
  const items = normalizeSaleItems(raw, responseBody);
  const cashAmount = payments.filter((payment) => payment.isCash).reduce((sum, payment) => sum + payment.amount, 0);
  const sourceUpdatedAt = String(sale.updatedAt ?? sale.updated_at ?? sale.modifiedAt ?? sale.modified_at ?? '').trim() || undefined;
  return {
    externalId,
    date,
    occurredAt,
    amount,
    status,
    sourceUpdatedAt,
    payments,
    items,
    cashAmount: Math.min(Math.max(cashAmount, 0), amount),
    deleted,
    metadata: { status, source: 'fudo', ...(occurredAt ? { occurredAt } : {}), ...(items.length ? { items } : {}) },
  };
}

function bodyData(body: any): any[] {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.sales)) return body.sales;
  if (Array.isArray(body)) return body;
  return [];
}

async function fetchSalesPage(token: string, page: number, fromDate: string) {
  const params = new URLSearchParams();
  params.set('page[size]', String(PAGE_SIZE));
  params.set('page[number]', String(page));
  params.set('include', SALES_INCLUDE);
  params.set('sort', '-createdAt');
  params.set('filter[createdAt][gte]', `${fromDate}T00:00:00`);
  const primaryUrl = `${API_BASE}${SALES_PATH}?${params}`;
  let response = await fetch(primaryUrl, { headers: jsonHeaders(token), cache: 'no-store' });
  let body = await responseJson(response);
  if (!response.ok && [400, 404, 422].includes(response.status)) {
    // Algunas cuentas/versiones pueden no aceptar los filtros JSON:API. En ese caso usamos
    // una consulta conservadora y filtramos las fechas en Lebu sin inventar parámetros.
    const fallbackParams = new URLSearchParams({ include: SALES_FALLBACK_INCLUDE });
    fallbackParams.set('page[size]', String(PAGE_SIZE));
    fallbackParams.set('page[number]', String(page));
    response = await fetch(`${API_BASE}${SALES_PATH}?${fallbackParams}`, { headers: jsonHeaders(token), cache: 'no-store' });
    body = await responseJson(response);
  }
  if (!response.ok) throw new Error(`No se pudieron leer ventas de FUDO: ${errorMessage(body, `HTTP ${response.status}`)}`);
  return body;
}

export async function fetchFudoSales(connection: FudoConnectionRow, fromDate: string) {
  const { token } = await getFudoAccessToken(connection);
  const normalized = new Map<string, NormalizedFudoSale>();
  for (let page = 1; page <= 200; page += 1) {
    const body = await fetchSalesPage(token, page, fromDate);
    const rows = bodyData(body);
    if (!rows.length) break;
    let oldest = '9999-12-31';
    for (const row of rows) {
      const sale = normalizeFudoSale(row, body);
      if (!sale) continue;
      if (sale.date < oldest) oldest = sale.date;
      if (sale.date >= fromDate) normalized.set(sale.externalId, sale);
    }
    const next = body?.links?.next || body?.meta?.next;
    if (rows.length < PAGE_SIZE || next === null || next === false || oldest < fromDate) break;
  }
  return [...normalized.values()];
}

function safeExternalNumericId(externalId: string) {
  // 48 bits => siempre cabe de forma exacta en Number/JSON y evita colisiones prácticas.
  const digest = crypto.createHash('sha256').update(`fudo:${externalId}`).digest();
  const value = digest.readUIntBE(0, 6);
  return 4_000_000_000_000_000 + value;
}

function cashTimestamp(sale: NormalizedFudoSale) {
  // Si FUDO entrega la hora real del cobro, la conservamos. Si solo entrega fecha, usamos
  // el inicio UTC del día de forma conservadora: una conciliación posterior del mismo día
  // absorbe esa venta en vez de correr el riesgo de sumarla dos veces por inventar una hora.
  return sale.occurredAt || `${sale.date}T00:00:00.000Z`;
}

export async function upsertFudoSales(businessId: string, sales: NormalizedFudoSale[]) {
  if (!sales.length) return 0;
  const rows = sales.map((sale) => ({
    business_id: businessId,
    id: safeExternalNumericId(sale.externalId),
    sale_date: sale.date,
    amount: sale.amount,
    source: 'fudo',
    external_id: sale.externalId,
    source_updated_at: sale.sourceUpdatedAt || null,
    source_metadata: sale.metadata,
    payment_breakdown: sale.payments,
    cash_effect_amount: sale.cashAmount > 0 ? sale.cashAmount : null,
    cash_effect_at: sale.cashAmount > 0 ? cashTimestamp(sale) : null,
    deleted_at: sale.deleted ? new Date().toISOString() : null,
    updated_by_client: 'fudo-connect',
    updated_at: new Date().toISOString(),
  }));

  for (let start = 0; start < rows.length; start += 250) {
    const batch = rows.slice(start, start + 250);
    const response = await supabaseRest('business_sales?on_conflict=business_id,source,external_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    if (!response.ok) {
      const body = await responseJson(response);
      throw new Error(`No se pudieron guardar ventas FUDO en Lebu: ${errorMessage(body, `HTTP ${response.status}`)}`);
    }
  }
  return rows.length;
}

export async function markFudoSyncResult(businessId: string, count: number, error?: string) {
  const response = await supabaseRest(`business_fudo_connections?business_id=eq.${encodeURIComponent(businessId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(error ? {
      status: 'error', last_error: error.slice(0, 500), updated_at: new Date().toISOString(),
    } : {
      status: 'connected', last_error: null, last_sync_at: new Date().toISOString(), last_sync_sales_count: count, updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error('No se pudo registrar el resultado de la sincronización FUDO.');
}

export async function refreshFudoSalesForBusiness(businessId: string, days = 14) {
  const connection = await loadFudoConnection(businessId);
  if (!connection || connection.status === 'disconnected') return { connected: false, imported: 0 };
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.min(Math.max(days, 1), 730));
  const fromDate = date.toISOString().slice(0, 10);
  try {
    const sales = await fetchFudoSales(connection, fromDate);
    const imported = await upsertFudoSales(businessId, sales);
    await markFudoSyncResult(businessId, imported);
    return { connected: true, imported };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo refrescar FUDO.';
    await markFudoSyncResult(businessId, 0, message).catch(() => undefined);
    throw error;
  }
}
