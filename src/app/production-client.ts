'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './cloud-sync';
import type { ProductionDay, ProductionEvent, ProductionEventType, ProductionProduct, ProductionShelfLife } from './production';

function createProductionId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function isoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function lookbackDate(days = 120) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}

function toProduct(row: Record<string, any>): ProductionProduct {
  return {
    id: Number(row.id),
    businessId: String(row.business_id || ''),
    name: String(row.name || ''),
    unitCost: row.unit_cost == null || row.unit_cost === '' ? null : Number(row.unit_cost),
    shelfLife: (['same_day', 'carry', 'durable'].includes(String(row.shelf_life)) ? row.shelf_life : 'same_day') as ProductionShelfLife,
    saleAliases: Array.isArray(row.sale_aliases) ? row.sale_aliases.map(String) : [],
    active: row.active !== false,
    sortOrder: Number(row.sort_order || 0),
  };
}

function toEvent(row: Record<string, any>): ProductionEvent {
  return {
    id: Number(row.id),
    businessId: String(row.business_id || ''),
    productId: Number(row.product_id),
    date: String(row.production_date || ''),
    type: String(row.event_type || '') as ProductionEventType,
    quantity: Number(row.quantity || 0),
    occurredAt: String(row.occurred_at || ''),
    note: String(row.note || ''),
  };
}

function toDay(row: Record<string, any>): ProductionDay {
  return {
    businessId: String(row.business_id || ''),
    date: String(row.production_date || ''),
    closedAt: row.closed_at ? String(row.closed_at) : null,
  };
}

export type ProductionProductDraft = {
  id?: number;
  name: string;
  unitCost?: number | null;
  shelfLife?: ProductionShelfLife;
  saleAliases?: string[];
  active?: boolean;
  sortOrder?: number;
};

export type ProductionEventDraft = {
  id?: number;
  productId: number;
  date: string;
  type: ProductionEventType;
  quantity: number;
  occurredAt?: string;
  note?: string;
};

export function useProductionData(businessId: string | null, enabled = true) {
  const [products, setProducts] = useState<ProductionProduct[]>([]);
  const [events, setEvents] = useState<ProductionEvent[]>([]);
  const [days, setDays] = useState<ProductionDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refreshBusyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!businessId || !enabled || refreshBusyRef.current) return;
    refreshBusyRef.current = true;
    setLoading(true);
    try {
      const since = lookbackDate(140);
      const [productsResult, eventsResult, daysResult] = await Promise.all([
        supabase.from('business_production_products').select('*').eq('business_id', businessId).order('sort_order').order('name'),
        supabase.from('business_production_events').select('*').eq('business_id', businessId).gte('production_date', since).order('occurred_at'),
        supabase.from('business_production_days').select('*').eq('business_id', businessId).gte('production_date', since).order('production_date'),
      ]);
      if (productsResult.error) throw productsResult.error;
      if (eventsResult.error) throw eventsResult.error;
      if (daysResult.error) throw daysResult.error;
      setProducts((productsResult.data || []).map((row) => toProduct(row as Record<string, any>)));
      setEvents((eventsResult.data || []).map((row) => toEvent(row as Record<string, any>)));
      setDays((daysResult.data || []).map((row) => toDay(row as Record<string, any>)));
      setError('');
    } catch (cause: any) {
      setError(cause?.message || 'No pudimos sincronizar Producción.');
    } finally {
      setLoading(false);
      refreshBusyRef.current = false;
    }
  }, [businessId, enabled]);

  useEffect(() => {
    if (!businessId || !enabled) {
      setProducts([]);
      setEvents([]);
      setDays([]);
      setError('');
      return;
    }
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh();
    }, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [businessId, enabled, refresh]);

  const saveProduct = useCallback(async (draft: ProductionProductDraft) => {
    if (!businessId) throw new Error('Necesitás un negocio sincronizado para usar Producción.');
    const name = String(draft.name || '').trim();
    if (!name) throw new Error('Escribí un nombre para el producto.');
    const id = draft.id || createProductionId();
    const row = {
      id,
      business_id: businessId,
      name,
      unit_cost: draft.unitCost == null || !Number.isFinite(Number(draft.unitCost)) ? null : Math.max(Number(draft.unitCost), 0),
      shelf_life: draft.shelfLife || 'same_day',
      sale_aliases: [...new Set((draft.saleAliases || []).map((value) => String(value).trim()).filter(Boolean))],
      active: draft.active !== false,
      sort_order: Number.isFinite(Number(draft.sortOrder)) ? Number(draft.sortOrder) : 0,
      updated_at: new Date().toISOString(),
    };
    const { error: writeError } = await supabase.from('business_production_products').upsert(row, { onConflict: 'id' });
    if (writeError) throw writeError;
    await refresh();
    return id;
  }, [businessId, refresh]);

  const addEvents = useCallback(async (drafts: ProductionEventDraft[]) => {
    if (!businessId) throw new Error('Necesitás un negocio sincronizado para usar Producción.');
    const valid = drafts.filter((draft) => draft.productId && draft.date && Number.isFinite(Number(draft.quantity)) && Number(draft.quantity) !== 0);
    if (!valid.length) return [] as number[];
    const rows = valid.map((draft) => ({
      id: draft.id || createProductionId(),
      business_id: businessId,
      product_id: draft.productId,
      production_date: draft.date,
      event_type: draft.type,
      quantity: Number(draft.quantity),
      occurred_at: draft.occurredAt || new Date().toISOString(),
      note: String(draft.note || '').trim(),
      updated_at: new Date().toISOString(),
    }));
    const { error: writeError } = await supabase.from('business_production_events').insert(rows);
    if (writeError) throw writeError;
    await refresh();
    return rows.map((row) => row.id);
  }, [businessId, refresh]);

  const ensureDay = useCallback(async (date: string) => {
    if (!businessId) throw new Error('Necesitás un negocio sincronizado para usar Producción.');
    const now = new Date().toISOString();
    const { error: writeError } = await supabase.from('business_production_days').upsert({
      business_id: businessId,
      production_date: date,
      updated_at: now,
    }, { onConflict: 'business_id,production_date' });
    if (writeError) throw writeError;
  }, [businessId]);

  const startDay = useCallback(async (date: string, opening: Array<{ productId: number; quantity: number }>) => {
    await ensureDay(date);
    const existingOpening = new Set(events.filter((event) => event.date === date && event.type === 'opening').map((event) => event.productId));
    const drafts = opening
      .filter((item) => item.quantity > 0 && !existingOpening.has(item.productId))
      .map((item) => ({ productId: item.productId, date, type: 'opening' as const, quantity: item.quantity, note: 'Disponibilidad al abrir' }));
    if (drafts.length) await addEvents(drafts);
    else await refresh();
  }, [addEvents, ensureDay, events, refresh]);

  const closeDay = useCallback(async (date: string, closures: Array<{ productId: number; waste: number; carry: number }>) => {
    if (!businessId) throw new Error('Necesitás un negocio sincronizado para usar Producción.');
    const now = new Date().toISOString();
    const drafts: ProductionEventDraft[] = [];
    for (const row of closures) {
      if (row.waste > 0) drafts.push({ productId: row.productId, date, type: 'waste', quantity: row.waste, occurredAt: now, note: 'Cierre del día' });
      if (row.carry > 0) drafts.push({ productId: row.productId, date, type: 'carry', quantity: row.carry, occurredAt: now, note: 'Pasa al próximo día' });
    }
    if (drafts.length) await addEvents(drafts);
    const { error: writeError } = await supabase.from('business_production_days').upsert({
      business_id: businessId,
      production_date: date,
      closed_at: now,
      updated_at: now,
    }, { onConflict: 'business_id,production_date' });
    if (writeError) throw writeError;
    await refresh();
  }, [addEvents, businessId, refresh]);

  const reopenDay = useCallback(async (date: string) => {
    if (!businessId) throw new Error('Necesitás un negocio sincronizado para usar Producción.');
    // Reabrir elimina únicamente los eventos que generó el cierre automático para que un
    // segundo cierre no duplique merma/carry. Los demás eventos del día quedan intactos.
    const { error: closureError } = await supabase
      .from('business_production_events')
      .delete()
      .eq('business_id', businessId)
      .eq('production_date', date)
      .eq('note', 'Cierre del día')
      .in('event_type', ['waste', 'carry']);
    if (closureError) throw closureError;
    const { error: writeError } = await supabase.from('business_production_days').update({ closed_at: null, updated_at: new Date().toISOString() }).eq('business_id', businessId).eq('production_date', date);
    if (writeError) throw writeError;
    await refresh();
  }, [businessId, refresh]);

  const deactivateProduct = useCallback(async (productId: number) => {
    if (!businessId) throw new Error('Necesitás un negocio sincronizado para usar Producción.');
    const { error: writeError } = await supabase.from('business_production_products').update({ active: false, updated_at: new Date().toISOString() }).eq('business_id', businessId).eq('id', productId);
    if (writeError) throw writeError;
    await refresh();
  }, [businessId, refresh]);

  const today = isoDate(new Date());
  const todayDay = useMemo(() => days.find((day) => day.date === today) || null, [days, today]);

  return {
    products,
    events,
    days,
    todayDay,
    loading,
    error,
    refresh,
    saveProduct,
    deactivateProduct,
    addEvents,
    startDay,
    closeDay,
    reopenDay,
  };
}
