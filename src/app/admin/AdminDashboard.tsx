'use client';

import { createClient } from '@supabase/supabase-js';
import { Activity, BellRing, Building2, CheckCircle2, RefreshCw, ShieldCheck, Target, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_example';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

type MetricsPayload = {
  generatedAt: string;
  metrics: {
    registeredUsers: number;
    signedIn7d: number;
    signedIn30d: number;
    businesses: number;
    activatedBusinesses: number;
    activeBusinesses7d: number;
    activeBusinesses30d: number;
    memberships: number;
    pushSubscriptions: number;
  };
  funnel: {
    registered: number;
    hasBusiness: number;
    hasGoal: number;
    hasProgress: number;
    activated: number;
    active7d: number;
  };
  businesses: Array<{
    id: string;
    name: string;
    createdAt: string;
    ownerEmail: string | null;
    memberCount: number;
    salesCount: number;
    expenseCount: number;
    hasGoal: boolean;
    hasInitialSummary: boolean;
    hasProgress: boolean;
    activated: boolean;
    lastActivity: string | null;
    active7d: boolean;
    active30d: boolean;
  }>;
  recentUsers: Array<{
    email: string;
    createdAt: string | null;
    lastSignInAt: string | null;
    membershipCount: number;
  }>;
};

function dateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function relativeTime(value: string | null) {
  if (!value) return 'Sin actividad';
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return '—';
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 60) return minutes <= 1 ? 'Hace un momento' : `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Ayer' : `Hace ${days} días`;
}

function pct(value: number, total: number) {
  if (!total) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

export default function AdminDashboard() {
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'signed-out'>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setStatus('loading');
    setMessage('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setStatus('signed-out');
        return;
      }
      const response = await fetch('/api/admin/metrics', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'No pudimos cargar Lebu Admin.');
      setPayload(json as MetricsPayload);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No pudimos cargar Lebu Admin.');
      setStatus('error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const funnelSteps = useMemo(() => payload ? [
    ['Registrados', payload.funnel.registered],
    ['Con negocio', payload.funnel.hasBusiness],
    ['Con objetivo', payload.funnel.hasGoal],
    ['Cargaron progreso', payload.funnel.hasProgress],
    ['Activados', payload.funnel.activated],
    ['Activos 7 días', payload.funnel.active7d],
  ] as const : [], [payload]);

  if (status === 'loading') {
    return <main className="admin-shell"><div className="admin-state-card"><RefreshCw className="admin-spin" size={24} /><strong>Cargando Lebu Admin…</strong></div></main>;
  }

  if (status === 'signed-out') {
    return (
      <main className="admin-shell">
        <div className="admin-state-card">
          <ShieldCheck size={30} />
          <h1>Lebu Admin</h1>
          <p>Primero iniciá sesión en Lebu con una cuenta administradora y después volvé a <strong>/admin</strong>.</p>
          <Link className="admin-primary-button" href="/">Ir a Lebu</Link>
        </div>
      </main>
    );
  }

  if (status === 'error' || !payload) {
    return (
      <main className="admin-shell">
        <div className="admin-state-card admin-error-card">
          <ShieldCheck size={30} />
          <h1>No pudimos abrir Lebu Admin</h1>
          <p>{message}</p>
          <button className="admin-primary-button" onClick={() => void load()}>Reintentar</button>
        </div>
      </main>
    );
  }

  const cards = [
    { label: 'Usuarios registrados', value: payload.metrics.registeredUsers, sub: `${payload.metrics.signedIn7d} en 7d · ${payload.metrics.signedIn30d} en 30d`, icon: Users },
    { label: 'Negocios', value: payload.metrics.businesses, sub: `${payload.metrics.activatedBusinesses} activados`, icon: Building2 },
    { label: 'Negocios activos 7d', value: payload.metrics.activeBusinesses7d, sub: `${payload.metrics.activeBusinesses30d} activos en 30d`, icon: Activity },
    { label: 'Notificaciones', value: payload.metrics.pushSubscriptions, sub: 'dispositivos suscriptos', icon: BellRing },
  ];

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <div className="admin-eyebrow">INTERNO · BETA</div>
          <h1>Lebu Admin</h1>
          <p>Monitoreo de adopción, activación y uso. Sin exponer montos financieros de los negocios.</p>
        </div>
        <div className="admin-header-actions">
          <span className="admin-updated">Actualizado {dateTime(payload.generatedAt)}</span>
          <button className="admin-secondary-button" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'admin-spin' : ''} /> Actualizar
          </button>
          <Link className="admin-secondary-button" href="/">Volver a Lebu</Link>
        </div>
      </header>

      <section className="admin-metric-grid">
        {cards.map(({ label, value, sub, icon: Icon }) => (
          <article className="admin-metric-card" key={label}>
            <div className="admin-metric-icon"><Icon size={19} /></div>
            <div className="admin-metric-label">{label}</div>
            <div className="admin-metric-value">{value}</div>
            <div className="admin-metric-sub">{sub}</div>
          </article>
        ))}
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <div className="admin-eyebrow">EMBUDO BETA</div>
            <h2>¿Hasta dónde llega la gente?</h2>
          </div>
          <span className="admin-muted">“Activado” = negocio con objetivo + progreso cargado (movimientos o acumulado inicial).</span>
        </div>
        <div className="admin-funnel">
          {funnelSteps.map(([label, value], index) => {
            const base = payload.funnel.registered || 1;
            const previous = index === 0 ? value : funnelSteps[index - 1][1];
            return (
              <div className="admin-funnel-step" key={label}>
                <div className="admin-funnel-top"><span>{label}</span><strong>{value}</strong></div>
                <div className="admin-funnel-track"><div className="admin-funnel-fill" style={{ width: `${Math.max(value ? 8 : 0, (value / base) * 100)}%` }} /></div>
                <div className="admin-funnel-rate">{index === 0 ? '100%' : `${pct(value, previous)} del paso anterior`}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <div className="admin-eyebrow">NEGOCIOS</div>
            <h2>Actividad de la beta</h2>
          </div>
          <span className="admin-muted">Última actividad = cambios de plan, movimientos o snapshots.</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Negocio</th><th>Estado</th><th>Miembros</th><th>Movimientos</th><th>Última actividad</th></tr></thead>
            <tbody>
              {payload.businesses.map((business) => (
                <tr key={business.id}>
                  <td><strong>{business.name}</strong><small>{business.ownerEmail || 'Sin owner identificado'}</small></td>
                  <td>{business.activated ? <span className="admin-status admin-status-good"><CheckCircle2 size={14} /> Activado</span> : business.hasGoal ? <span className="admin-status"><Target size={14} /> Falta progreso</span> : <span className="admin-status admin-status-muted">Sin objetivo</span>}</td>
                  <td>{business.memberCount}</td>
                  <td><strong>{business.salesCount + business.expenseCount}</strong><small>{business.salesCount} ventas · {business.expenseCount} gastos{business.hasInitialSummary ? ' · + acumulado inicial' : ''}</small></td>
                  <td><strong>{relativeTime(business.lastActivity)}</strong><small>{dateTime(business.lastActivity)}</small></td>
                </tr>
              ))}
              {!payload.businesses.length && <tr><td colSpan={5} className="admin-empty">Todavía no hay negocios.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <div className="admin-eyebrow">USUARIOS</div>
            <h2>Registros recientes</h2>
          </div>
          <span className="admin-muted">Últimos 20 usuarios registrados.</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Usuario</th><th>Registro</th><th>Último ingreso</th><th>Negocios</th></tr></thead>
            <tbody>
              {payload.recentUsers.map((user) => (
                <tr key={`${user.email}-${user.createdAt}`}>
                  <td><strong>{user.email || 'Sin email'}</strong></td>
                  <td>{dateTime(user.createdAt)}</td>
                  <td><strong>{relativeTime(user.lastSignInAt)}</strong><small>{dateTime(user.lastSignInAt)}</small></td>
                  <td>{user.membershipCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
