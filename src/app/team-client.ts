'use client';

import { supabase } from './cloud-sync';

export type TeamRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type InvitabledTeamRole = Exclude<TeamRole, 'owner'>;

export type TeamMember = {
  userId: string;
  email: string;
  role: TeamRole;
  joinedAt: string;
};

export type TeamInvitation = {
  id: string;
  email: string;
  role: InvitabledTeamRole;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
};

export type TeamOverview = {
  members: TeamMember[];
  invitations: TeamInvitation[];
};

function throwIfError(error: { message?: string } | null) {
  if (error) throw new Error(error.message || 'No se pudo actualizar el equipo.');
}

export async function fetchTeamOverview(businessId: string): Promise<TeamOverview> {
  const [membersResult, invitationsResult] = await Promise.all([
    supabase
      .from('business_members')
      .select('user_id, role, member_email, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true }),
    supabase
      .from('business_invitations')
      .select('id, email, role, status, created_at, expires_at')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ]);

  throwIfError(membersResult.error);
  // Operador/lectura no tienen permiso para ver invitaciones pendientes. RLS normalmente
  // devuelve una lista vacía; si el backend responde 403, no rompe la pantalla de equipo.
  if (invitationsResult.error && !/permission|row-level security|not allowed/i.test(invitationsResult.error.message || '')) {
    throwIfError(invitationsResult.error);
  }

  return {
    members: (membersResult.data || []).map((row: any) => ({
      userId: String(row.user_id),
      email: String(row.member_email || 'Miembro de Lebu'),
      role: row.role as TeamRole,
      joinedAt: String(row.created_at || ''),
    })),
    invitations: (invitationsResult.data || []).map((row: any) => ({
      id: String(row.id),
      email: String(row.email),
      role: row.role as InvitabledTeamRole,
      status: row.status as TeamInvitation['status'],
      createdAt: String(row.created_at || ''),
      expiresAt: String(row.expires_at || ''),
    })),
  };
}

export async function inviteTeamMember(businessId: string, email: string, role: InvitabledTeamRole) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Volvé a iniciar sesión para invitar a alguien.');

  const response = await fetch('/api/team/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ businessId, email: email.trim().toLowerCase(), role }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'No se pudo enviar la invitación.');
  return payload as { delivery: 'invite' | 'signin_link'; message: string };
}

export async function updateTeamMemberRole(businessId: string, userId: string, role: InvitabledTeamRole) {
  const { error } = await supabase.rpc('update_business_member_role', {
    target_business_id: businessId,
    target_user_id: userId,
    new_role: role,
  });
  throwIfError(error);
}

export async function removeTeamMember(businessId: string, userId: string) {
  const { error } = await supabase.rpc('remove_business_member', {
    target_business_id: businessId,
    target_user_id: userId,
  });
  throwIfError(error);
}

export async function cancelTeamInvitation(invitationId: string) {
  const { error } = await supabase.rpc('cancel_team_invitation', { invitation_id: invitationId });
  throwIfError(error);
}


export async function renameBusiness(businessId: string, name: string) {
  const clean = name.trim();
  if (clean.length < 2) throw new Error('Escribí un nombre de al menos 2 caracteres.');
  const { error } = await supabase.from('businesses').update({ name: clean }).eq('id', businessId);
  throwIfError(error);
}

export async function updateAccountPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  throwIfError(error);
}
