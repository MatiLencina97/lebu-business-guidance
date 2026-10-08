'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './cloud-sync';
import type { BusinessEvent, BusinessEventStatus } from './events';

function createEventId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function toEvent(row: Record<string, any>): BusinessEvent {
  return {
    id: Number(row.id),
    businessId: String(row.business_id || ''),
    date: String(row.event_date || ''),
    name: String(row.name || ''),
    location: String(row.location || ''),
    attendees: Number(row.attendees || 0),
    averageTicket: Number(row.average_ticket || 0),
    fixedCost: Number(row.fixed_cost || 0),
    variableCostPerPerson: Number(row.variable_cost_per_person || 0),
    expectedConversionPct: Number(row.expected_conversion_pct ?? 50),
    status: String(row.status || 'lead') as BusinessEventStatus,
    notes: String(row.notes || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

export type BusinessEventDraft = {
  id?: number;
  date: string;
  name: string;
  location?: string;
  attendees: number;
  averageTicket: number;
  fixedCost: number;
  variableCostPerPerson: number;
  expectedConversionPct: number;
  status: BusinessEventStatus;
  notes?: string;
};

export function useEventsData(businessId: string | null, enabled = true) {
  const [events, setEvents] = useState<BusinessEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refreshBusyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!businessId || !enabled || refreshBusyRef.current) return;
    refreshBusyRef.current = true;
    setLoading(true);
    try {
      const { data, error: readError } = await supabase
        .from('business_events')
        .select('*')
        .eq('business_id', businessId)
        .order('event_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (readError) throw readError;
      setEvents((data || []).map((row) => toEvent(row as Record<string, any>)));
      setError('');
    } catch (cause: any) {
      setError(cause?.message || 'No pudimos sincronizar Eventos.');
    } finally {
      setLoading(false);
      refreshBusyRef.current = false;
    }
  }, [businessId, enabled]);

  useEffect(() => {
    if (!businessId || !enabled) {
      setEvents([]);
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

  const saveEvent = useCallback(async (draft: BusinessEventDraft) => {
    if (!businessId) throw new Error('Necesitás un negocio sincronizado para guardar eventos.');
    const name = String(draft.name || '').trim();
    if (!name) throw new Error('Poné un nombre para el evento.');
    if (!draft.date) throw new Error('Elegí la fecha del evento.');

    const id = draft.id || createEventId();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id || null;
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      id,
      business_id: businessId,
      event_date: draft.date,
      name,
      location: String(draft.location || '').trim(),
      attendees: Math.max(Math.floor(Number(draft.attendees) || 0), 0),
      average_ticket: Math.max(Number(draft.averageTicket) || 0, 0),
      fixed_cost: Math.max(Number(draft.fixedCost) || 0, 0),
      variable_cost_per_person: Math.max(Number(draft.variableCostPerPerson) || 0, 0),
      expected_conversion_pct: Math.min(Math.max(Number(draft.expectedConversionPct) || 0, 0), 100),
      status: draft.status,
      notes: String(draft.notes || '').trim(),
      updated_by: userId,
      updated_at: now,
    };
    if (!draft.id) {
      row.created_by = userId;
      row.created_at = now;
    }

    const { error: writeError } = await supabase.from('business_events').upsert(row, { onConflict: 'id' });
    if (writeError) throw writeError;
    await refresh();
    return id;
  }, [businessId, refresh]);

  const deleteEvent = useCallback(async (eventId: number) => {
    if (!businessId) throw new Error('Necesitás un negocio sincronizado para modificar eventos.');
    const { error: writeError } = await supabase
      .from('business_events')
      .delete()
      .eq('business_id', businessId)
      .eq('id', eventId);
    if (writeError) throw writeError;
    await refresh();
  }, [businessId, refresh]);

  return { events, loading, error, refresh, saveEvent, deleteEvent };
}
