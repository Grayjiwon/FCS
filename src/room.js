import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { cfg } from './config.js';
import { dbUpdateMatch } from './db.js';

function clip(name, max=16) {
  if (!name) return '이름';
  name = String(name).replace(/[\r\n]/g,' ').trim();
  return name.length > max ? name.slice(0,max-1)+'…' : name;
}
function kstDateStr(d=new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);
}
async function displayName(guild, id) {
  try {
    const m = await guild.members.fetch(id);
    return m?.displayName || m?.user?.username || `user-${id.slice(-4)}`;
  } catch { return `user-${id.slice(-4)}`; }
}
export function makeRoomName(req, cand, dateStr) {
  return `${clip(req)} - ${clip(cand)} - ${dateStr}`.slice(0, 96);
}
function hasManageChannels(guild) {
  const me = guild.members.me;
  return !!(me && me.permissions.has(PermissionFlagsBits.ManageChannels));
}

export async function createVoiceRoomAuto(client, { matchId, guildId, requesterId, candidateId }) {
  const guild = await client.guilds.fetch(guildId);
  if (!hasManageChannels(guild)) throw new Error('Manage Channels 권한 부족');

  const req = await displayName(guild, requesterId);
  const cand = await displayName(guild, candidateId);
  const name = makeRoomName(req, cand, kstDateStr());

  const payload = {
    name,
    type: ChannelType.GuildVoice,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
      { id: requesterId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
      { id: candidateId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
    ]
  };
  if (cfg.categories.coffee) payload.parent = cfg.categories.coffee;

  const voice = await guild.channels.create(payload);

  await dbUpdateMatch(matchId, {
    status: 'confirmed',
    voice_channel_id: voice.id,
    started_at: new Date().toISOString()
  });

  // 2일 후 자동 정리
  setTimeout(async () => {
    try { await voice.delete('Auto close after 2 days'); } catch {}
    try { await dbUpdateMatch(matchId, { status: 'closed', closed_at: new Date().toISOString() }); } catch {}
  }, 2*24*60*60*1000);

  return voice;
}

