import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function allowedAdminEmails() {
  return (process.env.LEBU_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isoCutoff(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function maxIso(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (!valid.length) return null;
  return valid.reduce((latest, value) => (value > latest ? value : latest));
}

type UserSummary = {
  id: string;
  email: string;
  createdAt: string | null;
  lastSignInAt: string | null;
};

type BusinessRow = { id: string; name: string; created_at: string; updated_at: string | null };
type MemberRow = { business_id: string; user_id: string; role: string; member_email: string | null; created_at: string | null; updated_at: string | null };
type SettingsRow = { business_id: string; profit_target: number | string | null; historical_summary: unknown; updated_at: string | null };
type ActivityRow = { business_id: string; updated_at: string | null; deleted_at?: string | null };

export async function GET(request: NextRequest) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Lebu Admin no está configurado en el servidor.' }, { status: 503 });
  }

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Sesión requerida.' }, { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function listAllUsers() {
    const users: UserSummary[] = [];
    const perPage = 1000;
    let page = 1;

    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const batch = data.users || [];
      users.push(...batch.map((user) => ({
        id: user.id,
        email: user.email || '',
        createdAt: user.created_at || null,
        lastSignInAt: user.last_sign_in_at || null,
      })));
      if (batch.length < perPage) break;
      page += 1;
      if (page > 100) break;
    }

    return users;
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const email = authData.user?.email?.toLowerCase() || '';
  if (authError || !authData.user) return NextResponse.json({ error: 'Sesión inválida.' }, { status: 401 });

  const allowlist = allowedAdminEmails();
  if (!allowlist.length) {
    return NextResponse.json({ error: 'Falta configurar LEBU_ADMIN_EMAILS en Vercel.' }, { status: 503 });
  }
  if (!email || !allowlist.includes(email)) {
    return NextResponse.json({ error: 'No tenés acceso a Lebu Admin.' }, { status: 403 });
  }

  try {
    const [users, businessesResult, membersResult, settingsResult, salesResult, expensesResult, snapshotsResult, pushResult] = await Promise.all([
      listAllUsers(),
      admin.from('businesses').select('id,name,created_at,updated_at').order('created_at', { ascending: false }),
      admin.from('business_members').select('business_id,user_id,role,member_email,created_at,updated_at'),
      admin.from('business_settings').select('business_id,profit_target,historical_summary,updated_at'),
      admin.from('business_sales').select('business_id,updated_at,deleted_at'),
      admin.from('business_expenses').select('business_id,updated_at,deleted_at'),
      admin.from('business_daily_snapshots').select('business_id,updated_at,deleted_at'),
      admin.from('push_subscriptions').select('id,notifications_enabled,updated_at'),
    ]);

    const results = [businessesResult, membersResult, settingsResult, salesResult, expensesResult, snapshotsResult, pushResult];
    const firstError = results.find((result) => result.error)?.error;
    if (firstError) throw firstError;

    const businesses = (businessesResult.data || []) as BusinessRow[];
    const members = (membersResult.data || []) as MemberRow[];
    const settings = (settingsResult.data || []) as SettingsRow[];
    const sales = (salesResult.data || []) as ActivityRow[];
    const expenses = (expensesResult.data || []) as ActivityRow[];
    const snapshots = (snapshotsResult.data || []) as ActivityRow[];
    const pushSubscriptions = pushResult.data || [];

    const membersByBusiness = new Map<string, MemberRow[]>();
    members.forEach((row) => {
      const list = membersByBusiness.get(row.business_id) || [];
      list.push(row);
      membersByBusiness.set(row.business_id, list);
    });

    const settingsByBusiness = new Map(settings.map((row) => [row.business_id, row]));
    const salesByBusiness = new Map<string, ActivityRow[]>();
    const expensesByBusiness = new Map<string, ActivityRow[]>();
    const snapshotsByBusiness = new Map<string, ActivityRow[]>();

    const indexActivity = (rows: ActivityRow[], target: Map<string, ActivityRow[]>) => {
      rows.forEach((row) => {
        const list = target.get(row.business_id) || [];
        list.push(row);
        target.set(row.business_id, list);
      });
    };

    indexActivity(sales, salesByBusiness);
    indexActivity(expenses, expensesByBusiness);
    indexActivity(snapshots, snapshotsByBusiness);

    const sevenDaysAgo = isoCutoff(7);
    const thirtyDaysAgo = isoCutoff(30);
    const now = new Date().toISOString();

    const businessSummaries = businesses.map((business) => {
      const businessMembers = membersByBusiness.get(business.id) || [];
      const businessSettings = settingsByBusiness.get(business.id);
      const activeSales = (salesByBusiness.get(business.id) || []).filter((row) => !row.deleted_at);
      const activeExpenses = (expensesByBusiness.get(business.id) || []).filter((row) => !row.deleted_at);
      const activeSnapshots = (snapshotsByBusiness.get(business.id) || []).filter((row) => !row.deleted_at);
      const lastActivity = maxIso([
        business.updated_at,
        businessSettings?.updated_at,
        ...businessMembers.map((row) => row.updated_at || row.created_at),
        ...activeSales.map((row) => row.updated_at),
        ...activeExpenses.map((row) => row.updated_at),
        ...activeSnapshots.map((row) => row.updated_at),
      ]);
      const target = Number(businessSettings?.profit_target || 0);
      const historicalSummary = businessSettings?.historical_summary;
      const historicalSales = historicalSummary && typeof historicalSummary === 'object'
        ? Number((historicalSummary as { salesTotal?: unknown }).salesTotal || 0)
        : 0;
      const historicalExpenses = historicalSummary && typeof historicalSummary === 'object'
        ? Number((historicalSummary as { expensesTotal?: unknown }).expensesTotal || 0)
        : 0;
      const hasInitialSummary = (Number.isFinite(historicalSales) && historicalSales > 0)
        || (Number.isFinite(historicalExpenses) && historicalExpenses > 0);
      const hasProgress = activeSales.length > 0 || activeExpenses.length > 0 || hasInitialSummary;
      const activated = target > 0 && hasProgress;
      const owner = businessMembers.find((row) => row.role === 'owner');

      return {
        id: business.id,
        name: business.name || 'Sin nombre',
        createdAt: business.created_at,
        ownerEmail: owner?.member_email || null,
        memberCount: businessMembers.length,
        salesCount: activeSales.length,
        expenseCount: activeExpenses.length,
        hasGoal: target > 0,
        hasInitialSummary,
        hasProgress,
        activated,
        lastActivity,
        active7d: Boolean(lastActivity && lastActivity >= sevenDaysAgo && lastActivity <= now),
        active30d: Boolean(lastActivity && lastActivity >= thirtyDaysAgo && lastActivity <= now),
      };
    });

    const signedIn7d = users.filter((user) => user.lastSignInAt && user.lastSignInAt >= sevenDaysAgo).length;
    const signedIn30d = users.filter((user) => user.lastSignInAt && user.lastSignInAt >= thirtyDaysAgo).length;

    const recentUsers = [...users]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 20)
      .map((user) => ({
        email: user.email,
        createdAt: user.createdAt,
        lastSignInAt: user.lastSignInAt,
        membershipCount: members.filter((member) => member.user_id === user.id).length,
      }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      metrics: {
        registeredUsers: users.length,
        signedIn7d,
        signedIn30d,
        businesses: businesses.length,
        activatedBusinesses: businessSummaries.filter((business) => business.activated).length,
        activeBusinesses7d: businessSummaries.filter((business) => business.active7d).length,
        activeBusinesses30d: businessSummaries.filter((business) => business.active30d).length,
        memberships: members.length,
        pushSubscriptions: pushSubscriptions.filter((row: { notifications_enabled?: boolean | null }) => row.notifications_enabled !== false).length,
      },
      funnel: {
        registered: users.length,
        hasBusiness: new Set(members.map((row) => row.user_id)).size,
        hasGoal: businessSummaries.filter((business) => business.hasGoal).length,
        hasProgress: businessSummaries.filter((business) => business.hasProgress).length,
        activated: businessSummaries.filter((business) => business.activated).length,
        active7d: businessSummaries.filter((business) => business.active7d).length,
      },
      businesses: businessSummaries,
      recentUsers,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[lebu-admin] metrics error', error);
    return NextResponse.json({ error: 'No pudimos cargar las métricas de Lebu.' }, { status: 500 });
  }
}
