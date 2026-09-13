import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_example';
const PRODUCTION_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const configuredAppUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
const APP_URL = configuredAppUrl && !/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(configuredAppUrl)
  ? configuredAppUrl
  : PRODUCTION_APP_URL;

const allowedRoles = new Set(['admin', 'operator', 'viewer']);

function adminClient() {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function publicClient() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!token) return NextResponse.json({ error: 'Sesión requerida.' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const businessId = String(body?.businessId || '');
    const email = String(body?.email || '').trim().toLowerCase();
    const role = String(body?.role || '');

    if (!businessId || !email || !/^\S+@\S+\.\S+$/.test(email) || !allowedRoles.has(role)) {
      return NextResponse.json({ error: 'Revisá el mail y el rol de la invitación.' }, { status: 400 });
    }

    const admin = adminClient();
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return NextResponse.json({ error: 'La sesión venció. Volvé a ingresar.' }, { status: 401 });

    const { data: callerMembership, error: membershipError } = await admin
      .from('business_members')
      .select('role')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;

    const callerRole = callerMembership?.role;
    const canInvite = callerRole === 'owner' || (callerRole === 'admin' && role !== 'admin');
    if (!canInvite) return NextResponse.json({ error: 'No tenés permiso para invitar con ese rol.' }, { status: 403 });

    if (user.email?.toLowerCase() === email) {
      return NextResponse.json({ error: 'Ya formás parte del comercio con ese mail.' }, { status: 400 });
    }

    const { data: existingMember, error: existingMemberError } = await admin
      .from('business_members')
      .select('user_id, role')
      .eq('business_id', businessId)
      .eq('member_email', email)
      .maybeSingle();
    if (existingMemberError) throw existingMemberError;
    if (existingMember) return NextResponse.json({ error: 'Ese mail ya forma parte del equipo.' }, { status: 409 });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: priorInvite, error: priorInviteError } = await admin
      .from('business_invitations')
      .select('id')
      .eq('business_id', businessId)
      .ilike('email', email)
      .maybeSingle();
    if (priorInviteError) throw priorInviteError;

    if (priorInvite?.id) {
      const { error } = await admin.from('business_invitations').update({
        email,
        role,
        status: 'pending',
        invited_by: user.id,
        updated_at: now.toISOString(),
        expires_at: expiresAt,
        accepted_by: null,
        accepted_at: null,
      }).eq('id', priorInvite.id);
      if (error) throw error;
    } else {
      const { error } = await admin.from('business_invitations').insert({
        business_id: businessId,
        email,
        role,
        status: 'pending',
        invited_by: user.id,
        expires_at: expiresAt,
      });
      if (error) throw error;
    }

    const redirectTo = `${APP_URL.replace(/\/$/, '')}/?team_invite=1`;
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { lebu_team_invite: true, lebu_business_id: businessId, lebu_role: role },
    });

    if (!inviteError) {
      return NextResponse.json({ delivery: 'invite', message: 'Invitación enviada por mail.' });
    }

    // Supabase no permite inviteUserByEmail sobre una cuenta ya confirmada. En ese
    // caso enviamos un magic link: al ingresar, claim_my_team_invitations vincula
    // automáticamente la cuenta existente al comercio correcto.
    if (/already|registered|exists|duplicate/i.test(inviteError.message || '')) {
      const auth = publicClient();
      const { error: magicError } = await auth.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      if (!magicError) {
        return NextResponse.json({ delivery: 'signin_link', message: 'Ese mail ya tenía cuenta. Le enviamos un acceso para aceptar la invitación.' });
      }
      throw magicError;
    }

    throw inviteError;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo enviar la invitación.' }, { status: 500 });
  }
}
