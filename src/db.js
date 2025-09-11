import { createClient } from '@supabase/supabase-js';
import { cfg } from './config.js';

export const supabase = cfg.supabase.url && cfg.supabase.key
  ? createClient(cfg.supabase.url, cfg.supabase.key)
  : null;

export async function dbUpsertProfile(guildId, userId, p) {
  if (!supabase) return;
  const { error } = await supabase.from('profiles').upsert({
    user_id: userId, guild_id: guildId || '',
    name: p.name || '', purpose: p.purpose || '',
    interests: p.interests || [], intro: p.intro || '',
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function dbGetProfile(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('*')
    .eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? {
    user_id: data.user_id, guild_id: data.guild_id,
    name: data.name, purpose: data.purpose,
    interests: (data.interests || []).slice(0, 12),
    intro: data.intro
  } : null;
}

export async function dbGetGuildProfilesExcept(guildId, exceptUserId) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('profiles')
    .select('user_id,name,purpose,interests,intro')
    .eq('guild_id', guildId).neq('user_id', exceptUserId);
  if (error) throw error;
  return (data || []).map(r => ({
    user_id: r.user_id,
    p: { name: r.name, purpose: r.purpose, interests: (r.interests || []).slice(0, 12), intro: r.intro }
  }));
}

export async function dbInsertMessage(message) {
  if (!supabase) return;
  const { error } = await supabase.from('messages').insert({
    id: message.id, guild_id: message.guildId, channel_id: message.channelId,
    user_id: message.author.id, content: (message.content || '').slice(0, 2000),
    ts: new Date(message.createdTimestamp).toISOString()
  });
  if (error && error.code !== '23505') throw error;
}

export async function dbRecentTexts(guildId, userId, limit = 500) {
  if (!supabase) return '';
  const { data, error } = await supabase.from('messages')
    .select('content').eq('guild_id', guildId).eq('user_id', userId)
    .order('ts', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map(r => r.content || '').join(' ');
}

/* matches */
export async function dbInsertMatch(m) {
  if (!supabase) return;
  const { error } = await supabase.from('matches').insert({
    id: m.id, guild_id: m.guildId, requester_id: m.requesterId,
    candidate_id: m.candidateId, status: m.status || 'proposed',
    created_at: new Date().toISOString()
  });
  if (error && error.code !== '23505') throw error;
}

export async function dbUpdateMatch(id, patch) {
  if (!supabase) return;
  const { error } = await supabase.from('matches').update({
    ...patch, updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) throw error;
}
