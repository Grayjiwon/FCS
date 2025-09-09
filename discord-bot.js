// ESM
import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags, Events
} from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

/* ========= env ========= */
const {
  DISCORD_TOKEN: TOKEN,
  APP_ID,
  GUILD_ID,
  INTROS_HUB_CHANNEL_ID,
  LOG_CHANNEL_IDS = '',
  GEMINI_API_KEY = '',
  GEMINI_MODEL = 'gemini-2.5-flash',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
} = process.env;

const LOG_WHITELIST = LOG_CHANNEL_IDS.split(',').map(s => s.trim()).filter(Boolean);

/* ======== clients ======== */
const genai = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ========= helpers: text & tags ========= */
function safeTags(arr) {
  return (Array.isArray(arr) ? arr : []).map(s => String(s).trim()).filter(Boolean).slice(0, 12);
}
function buildProfileEmbed(p, title = '👤 프로필') {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x5865f2)
    .addFields(
      { name: '이름', value: p.name || '-', inline: true },
      { name: '한줄 소개', value: p.intro || '-', inline: true },
      { name: '관심사', value: safeTags(p.interests).join(' · ') || '-', inline: false },
      { name: '커피챗 목적', value: p.purpose || '-', inline: false },
    );
}
function textTokens(s = '') {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter(Boolean);
}
function tokenSetSim(a = '', b = '') {
  const A = new Set(textTokens(a)), B = new Set(textTokens(b));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter(x => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return inter / uni;
}
function jaccard(arrA = [], arrB = []) {
  const A = new Set(arrA), B = new Set(arrB);
  const inter = [...A].filter(x => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 0;
}
function uniqUnion(a = [], b = []) {
  return Array.from(new Set([...(a || []), ...(b || [])]));
}
function deriveTagsFromText(bigText = '') {
  const TEXT = bigText.toLowerCase();
  const TAGS = [
    'ai','ml','llm','nlp','cv','데이터','핀테크','투자','금융','블록체인','창업','스타트업','취업','이직',
    '백엔드','프론트엔드','ios','android','pm','디자인','마케팅','세일즈','보안','클라우드','게임',
    '로보틱스','바이오','교육','헬스케어','리서치','infra','devops','mle','product'
  ];
  const found = [];
  for (const t of TAGS) if (TEXT.includes(t)) found.push(t.toUpperCase());
  return safeTags(found);
}

/* ========= helpers: room naming / perms / eph / DM ========= */
function clipName(name, max = 16) {
  if (!name) return '이름';
  name = String(name).replace(/[\r\n]/g, ' ').trim();
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}
function kstDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d); // YYYY-MM-DD
}
async function displayNameInGuild(guild, userId) {
  try {
    const m = await guild.members.fetch(userId);
    return m?.displayName || m?.user?.username || `user-${userId.slice(-4)}`;
  } catch {
    return `user-${userId.slice(-4)}`;
  }
}
function makeRoomName(reqName, candName, dateStr) {
  const base = `${clipName(reqName)} - ${clipName(candName)} - ${dateStr}`;
  return base.slice(0, 96);
}
function checkBotChannelCreatePermission(guild) {
  const me = guild.members.me;
  const missing = [];
  if (!me) missing.push('봇 멤버 정보 없음');
  else if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) missing.push('Manage Channels');
  return { ok: missing.length === 0, missing };
}
const eph = (payload = {}) => ({ ...payload, flags: MessageFlags.Ephemeral });

async function sendDM(userId, payload) {
  try {
    const user = await client.users.fetch(userId);
    const dm = await user.createDM();
    const sent = await dm.send(payload);
    return sent;
  } catch (err) {
    console.warn(`DM 실패 → ${userId}:`, err?.message || err);
    return null;
  }
}
async function notifyOrFallback(userId, payload) {
  const sent = await sendDM(userId, payload);
  if (sent) return true;
  try {
    if (INTROS_HUB_CHANNEL_ID) {
      const hub = await client.channels.fetch(INTROS_HUB_CHANNEL_ID);
      await hub?.send({ content: `<@${userId}> DM 발송이 불가해 여기로 안내합니다.` });
      return true;
    }
  } catch {}
  return false;
}

/* ========= Gemini summarize ========= */
async function summarizeProfileWithGemini(name, narrative) {
  if (!genai) {
    const fallback = deriveTagsFromText(narrative);
    return {
      name: name || '이름 미상',
      purpose: (narrative || '').slice(0, 140),
      interests: fallback.length ? fallback : ['커리어','네트워킹'],
      intro: '관심 분야 논의 희망'
    };
  }
  const prompt = `
You are a professional networking assistant. Summarize the user's free-form text
into a clean profile JSON with the following schema. Return ONLY raw JSON.

Schema:
{ "name": string, "purpose": string, "interests": string[], "intro": string }

Guidelines:
- Use the given name if provided.
- "purpose": 80-140 chars, concrete and specific.
- "interests": 3-6 practical tags.
- "intro": one line, 30-80 chars, friendly.
- Language: Korean if input is Korean.

Input:
name: ${name}
narrative:
${narrative}
`.trim();

  const model = genai.getGenerativeModel({ model: GEMINI_MODEL });
  const result = await model.generateContent([{ text: prompt }]);
  const text = result.response.text() || '';
  const json = extractJson(text);
  const out = JSON.parse(json);
  return {
    name: out.name || name || '이름 미상',
    purpose: out.purpose || (narrative || '').slice(0, 140),
    interests: safeTags(out.interests),
    intro: out.intro || ''
  };
}
function extractJson(s) {
  const fenced = s.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return s.slice(start, end + 1);
  return s.trim();
}

/* ========= Supabase DB ========= */
async function dbUpsertProfile(guildId, userId, p) {
  const { error } = await supabase.from('profiles').upsert({
    user_id: userId,
    guild_id: guildId || '',
    name: p.name || '',
    purpose: p.purpose || '',
    interests: p.interests || [],
    intro: p.intro || '',
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) throw error;
}
async function dbGetProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    user_id: data.user_id,
    guild_id: data.guild_id,
    name: data.name,
    purpose: data.purpose,
    interests: safeTags(data.interests || []),
    intro: data.intro
  };
}
async function dbGetGuildProfilesExcept(guildId, exceptUserId) {
  const { data, error } = await supabase.from('profiles')
    .select('user_id,name,purpose,interests,intro')
    .eq('guild_id', guildId)
    .neq('user_id', exceptUserId);
  if (error) throw error;
  return (data || []).map(r => ({ user_id: r.user_id, p: { name: r.name, purpose: r.purpose, interests: safeTags(r.interests || []), intro: r.intro } }));
}
async function dbInsertMessage(message) {
  const { error } = await supabase.from('messages').insert({
    id: message.id,
    guild_id: message.guildId,
    channel_id: message.channelId,
    user_id: message.author.id,
    content: (message.content || '').slice(0, 2000),
    ts: new Date(message.createdTimestamp).toISOString()
  });
  if (error && error.code !== '23505') throw error;
}
async function dbRecentTexts(guildId, userId, limit = 500) {
  const { data, error } = await supabase.from('messages')
    .select('content')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('ts', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(r => r.content || '').join(' ');
}

/* ===== matches ===== */
async function dbInsertMatch(m) {
  const { error } = await supabase.from('matches').insert({
    id: m.id,
    guild_id: m.guildId,
    requester_id: m.requesterId,
    candidate_id: m.candidateId,
    status: m.status || 'proposed',
    created_at: new Date().toISOString()
  });
  if (error && error.code !== '23505') throw error;
}
async function dbUpdateMatch(id, patch) {
  const { error } = await supabase.from('matches').update({
    ...patch,
    updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) throw error;
}

/* ========= scoring ========= */
async function rankCandidatesWithLogs(me, guild) {
  const others = await dbGetGuildProfilesExcept(guild.id, me.__userId);
  const meTexts = await dbRecentTexts(guild.id, me.__userId, 500);
  const meLogTags = deriveTagsFromText(meTexts);
  const meMergedTags = uniqUnion(me.interests || [], meLogTags);

  const scored = [];
  for (const { user_id: userId, p } of others) {
    const theirTexts = await dbRecentTexts(guild.id, userId, 500);
    const theirLogTags = deriveTagsFromText(theirTexts);
    const theirMergedTags = uniqUnion(p.interests || [], theirLogTags);

    const interestScore = jaccard(meMergedTags, theirMergedTags);
    const purposeScore  = tokenSetSim(me.purpose || '', p.purpose || '');
    const score = 0.7 * interestScore + 0.3 * purposeScore;
    scored.push({ userId, p, score, details: { interestScore, purposeScore } });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/* ========= Commands ========= */
const commands = [
  new SlashCommandBuilder().setName('profile_ai').setDescription('이름+자유서술을 입력해서 AI로 프로필을 생성합니다.'),
  new SlashCommandBuilder().setName('recommend').setDescription('내 프로필 기반으로 후보 추천(채팅 로그 반영)'),
  new SlashCommandBuilder().setName('privacy').setDescription('개인정보/로그 수집 안내를 표시합니다.')
].map(c => c.toJSON());

/* ========= Client ========= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

/* ========= Register Commands ========= */
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: commands });
    console.log('✅ Registered guild commands');
  } else {
    await rest.put(Routes.applicationCommands(APP_ID), { body: commands });
    console.log('✅ Registered global commands (최대 1시간 지연 가능)');
  }
}

/* ========= Message Logging ========= */
client.on(Events.MessageCreate, async (m) => {
  try {
    if (!m.guildId) return;
    if (m.author?.bot) return;
    if (LOG_WHITELIST.length && !LOG_WHITELIST.includes(m.channelId)) return;
    if (!m.content || !m.content.trim()) return;

    await dbInsertMessage(m);

    if (INTROS_HUB_CHANNEL_ID && m.channelId === INTROS_HUB_CHANNEL_ID) {
      const prof = await dbGetProfile(m.author.id);
      if (!prof) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('onboard:start_profile').setLabel('프로필 설정 시작').setStyle(ButtonStyle.Primary),
        );
        await m.reply({ content: `어서오세요, <@${m.author.id}>! 매칭을 위해 먼저 프로필부터 만들어볼까요?`, components: [row] });
      }
    }
  } catch {}
});

/* ========= Onboarding: 길드 입장 시 허브 안내 ========= */
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (!INTROS_HUB_CHANNEL_ID) return;
    const channel = member.guild.channels.cache.get(INTROS_HUB_CHANNEL_ID);
    if (!channel) return;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('onboard:start_profile').setLabel('프로필 설정 시작').setStyle(ButtonStyle.Primary),
    );
    await channel.send({ content: `환영합니다, <@${member.id}>! 아래 버튼을 눌러 **프로필 설정**을 시작하세요.`, components: [row] });
  } catch {}
});

/* ===== 매칭 상태(메모리) ===== */
const memMatches = new Map(); // matchId -> { requesterId, candidateId, guildId, candAccepted, reqAccepted }

/* ===== 보이스룸 생성(2일 유지, STT 없음) ===== */
async function createVoiceRoomAuto(matchId, guildId, requesterId, candidateId) {
  const guild = await client.guilds.fetch(guildId);
  const perm = checkBotChannelCreatePermission(guild);
  if (!perm.ok) throw new Error(`권한 부족: ${perm.missing.join(', ')}`);

  const reqName  = await displayNameInGuild(guild, requesterId);
  const candName = await displayNameInGuild(guild, candidateId);
  const channelName = makeRoomName(reqName, candName, kstDateStr());

  const voice = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildVoice,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] },
      { id: requesterId, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak] },
      { id: candidateId, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak] },
    ],
  });

  await dbUpdateMatch(matchId, {
    status: 'confirmed',
    voice_channel_id: voice.id,
    started_at: new Date().toISOString()
  });

  setTimeout(async () => {
    try {
      await voice.delete('Auto close after 2 days');
      await dbUpdateMatch(matchId, { status: 'closed', closed_at: new Date().toISOString() });
    } catch (e) {
      console.warn('Auto-close fail:', e?.message || e);
    }
  }, 2*24*60*60*1000);

  return { voice };
}

/* ========= Interactions ========= */
client.on(Events.InteractionCreate, async (i) => {
  try {
    // /privacy
    if (i.isChatInputCommand() && i.commandName === 'privacy') {
      return i.reply(eph({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔒 개인정보/로그 수집 안내 (데모)')
            .setColor(0x5865f2)
            .setDescription([
              '- 이 서버에서의 텍스트 메시지를 저장하여 추천 품질을 향상합니다.',
              '- 대상 채널: ' + (LOG_WHITELIST.length ? LOG_WHITELIST.map(id => `<#${id}>`).join(', ') : '봇이 접근 가능한 텍스트 채널'),
              '- 보관: 원격 Supabase (관리자 요청 시 삭제 가능)',
              '- 원치 않으면 관리자에게 문의하세요.'
            ].join('\n'))
        ]
      }));
    }

    // 온보딩 버튼 → 모달 열기
    if (i.isButton() && i.customId === 'onboard:start_profile') {
      const modal = new ModalBuilder().setCustomId('profile_ai:submit').setTitle('AI 프로필 입력');
      const nameInput = new TextInputBuilder().setCustomId('name').setLabel('이름').setStyle(TextInputStyle.Short).setRequired(true);
      const narrativeInput = new TextInputBuilder().setCustomId('narrative').setLabel('왜 누구를 만나고 싶은가? (자유 서술)').setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(narrativeInput)
      );
      return i.showModal(modal);
    }

    // /profile_ai → 모달
    if (i.isChatInputCommand() && i.commandName === 'profile_ai') {
      const modal = new ModalBuilder().setCustomId('profile_ai:submit').setTitle('AI 프로필 입력');
      const nameInput = new TextInputBuilder().setCustomId('name').setLabel('이름').setStyle(TextInputStyle.Short).setRequired(true);
      const narrativeInput = new TextInputBuilder().setCustomId('narrative').setLabel('왜 누구를 만나고 싶은가? (자유 서술)').setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(narrativeInput)
      );
      return i.showModal(modal);
    }

    // 모달 제출 → 요약 → 저장 → 수정/확정/재생성
    if (i.isModalSubmit() && i.customId === 'profile_ai:submit') {
      const name = i.fields.getTextInputValue('name')?.trim();
      const narrative = i.fields.getTextInputValue('narrative')?.trim();
      if (!name || !narrative) return i.reply(eph({ content: '이름/서술이 필요합니다.' }));

      await i.reply(eph({ content: 'AI가 프로필을 정리하는 중…' }));

      let prof;
      try { prof = await summarizeProfileWithGemini(name, narrative); }
      catch { prof = { name, purpose: narrative.slice(0,140), interests: ['네트워킹'], intro: '요약 실패: 수동 수정 필요' }; }

      await dbUpsertProfile(i.guild?.id || '', i.user.id, prof);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('profile_ai:edit').setLabel('수정하기').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('profile_ai:confirm').setLabel('확정 저장').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('profile_ai:regen').setLabel('다시 생성').setStyle(ButtonStyle.Primary),
      );
      return i.editReply({
        content: 'AI 요약 결과입니다. 수정/확정/다시생성을 선택하세요.',
        embeds: [buildProfileEmbed(prof, '🤖 AI 요약 프로필')],
        components: [row],
      });
    }

    // 수정 모달
    if (i.isButton() && i.customId === 'profile_ai:edit') {
      const prof = (await dbGetProfile(i.user.id)) || {};
      const modal = new ModalBuilder().setCustomId('profile_ai:edit_submit').setTitle('프로필 수정');

      const name = new TextInputBuilder().setCustomId('name').setLabel('이름').setStyle(TextInputStyle.Short).setRequired(true).setValue(prof.name || '');
      const purpose = new TextInputBuilder().setCustomId('purpose').setLabel('커피챗 목적').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(prof.purpose || '');
      const interests = new TextInputBuilder().setCustomId('interests').setLabel('관심사(콤마 구분)').setStyle(TextInputStyle.Short).setRequired(false).setValue(safeTags(prof.interests).join(', '));
      const intro = new TextInputBuilder().setCustomId('intro').setLabel('한줄 소개').setStyle(TextInputStyle.Short).setRequired(false).setValue(prof.intro || '');

      modal.addComponents(
        new ActionRowBuilder().addComponents(name),
        new ActionRowBuilder().addComponents(purpose),
        new ActionRowBuilder().addComponents(interests),
        new ActionRowBuilder().addComponents(intro),
      );
      return i.showModal(modal);
    }

    // 수정 반영
    if (i.isModalSubmit() && i.customId === 'profile_ai:edit_submit') {
      const p = {
        name: i.fields.getTextInputValue('name')?.trim(),
        purpose: i.fields.getTextInputValue('purpose')?.trim(),
        interests: safeTags(i.fields.getTextInputValue('interests')?.split(',') || []),
        intro: i.fields.getTextInputValue('intro')?.trim()
      };
      if (!p.name || !p.purpose) return i.reply(eph({ content: '이름/목적은 필수입니다.' }));
      await dbUpsertProfile(i.guild?.id || '', i.user.id, p);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('profile_ai:confirm').setLabel('확정 저장').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('profile_ai:regen').setLabel('다시 생성').setStyle(ButtonStyle.Primary),
      );
      return i.reply(eph({
        content: '수정 완료. 아래 버튼으로 확정하거나, 다시 생성해 보세요.',
        embeds: [buildProfileEmbed(p, '✏️ 수정된 프로필')],
        components: [row],
      }));
    }

    // 확정 안내
    if (i.isButton() && i.customId === 'profile_ai:confirm') {
      if (!i.deferred && !i.replied) await i.deferUpdate().catch(() => {});
      return i.followUp(eph({ content: '✅ 프로필이 확정/저장되었습니다. 이제 `/recommend`로 추천을 받아보세요.' }));
    }

    // 다시 생성
    if (i.isButton() && i.customId === 'profile_ai:regen') {
      if (!i.deferred && !i.replied) await i.deferUpdate().catch(() => {});
      const base = await dbGetProfile(i.user.id);
      if (!base) return i.followUp(eph({ content: '먼저 /profile_ai 로 입력해 주세요.' }));
      const regenerated = await summarizeProfileWithGemini(base.name || '이름', base.purpose || base.intro || '요약 재생성');
      await dbUpsertProfile(i.guild?.id || '', i.user.id, regenerated);
      return i.followUp(eph({
        content: '🔄 다시 생성했습니다. 필요하면 수정 후 확정하세요.',
        embeds: [buildProfileEmbed(regenerated, '🤖 재생성 프로필')]
      }));
    }

    // 추천 → 후보 DM 제안
    if (i.isChatInputCommand() && i.commandName === 'recommend') {
      await i.deferReply(eph());

      const my = await dbGetProfile(i.user.id);
      if (!my) return i.editReply({ content: '먼저 `/profile_ai`로 프로필을 생성/확정해 주세요.' });
      my.__userId = i.user.id;

      const ranked = await rankCandidatesWithLogs(my, i.guild);
      if (!ranked.length) return i.editReply({ content: '추천 가능한 후보가 없습니다. 다른 멤버들도 /profile_ai 를 사용하도록 안내해 주세요.' });

      const top = ranked[0];
      const member = await i.guild.members.fetch(top.userId).catch(() => null);
      const candidateName = member ? member.user.username : `사용자(${top.userId})`;

      const preview = buildProfileEmbed(top.p, `🔎 추천 후보(미리보기): ${candidateName}`)
        .addFields({ name: '매칭 상세', value: `관심사 유사도: ${(top.details.interestScore*100|0)}%\n목적 유사도: ${(top.details.purposeScore*100|0)}%` });

      await i.editReply({ content: `이 후보에게 DM으로 제안을 보겠습니다.`, embeds: [preview] });

      // 매칭 생성 + 후보 DM
      const matchId = `m_${Date.now()}_${Math.floor(Math.random()*9999)}`;
      memMatches.set(matchId, { requesterId: i.user.id, candidateId: top.userId, guildId: i.guild.id, candAccepted: false, reqAccepted: false });

      await dbInsertMatch({ id: matchId, requesterId: i.user.id, candidateId: top.userId, guildId: i.guild.id, status: 'proposed' });

      const requesterProfile = my;
      const dmEmbed = new EmbedBuilder()
        .setTitle('☕ 커피챗 제안')
        .setColor(0x43b581)
        .setDescription(`안녕하세요! <@${i.user.id}> 님이 커피챗을 제안했어요.\n아래 정보를 보고 **수락/거절**을 눌러 주세요.`)
        .addFields(
          { name: '요청자', value: `<@${i.user.id}>`, inline: true },
          { name: '요청자 한줄소개', value: requesterProfile.intro || '-', inline: true },
          { name: '요청자 목적', value: requesterProfile.purpose || '-', inline: false },
          { name: '요청자 관심사', value: safeTags(requesterProfile.interests).join(' · ') || '-', inline: false },
        );

      const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`match:${matchId}:cand_accept`).setLabel('수락').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`match:${matchId}:cand_decline`).setLabel('거절').setStyle(ButtonStyle.Danger),
      );

      const ok = await notifyOrFallback(top.userId, { embeds: [dmEmbed], components: [actions] });
      await i.followUp(eph({ content: ok ? '✅ 후보에게 제안을 보냈어요. 응답을 기다리는 중…' : '⚠️ 후보 DM/폴백 모두 실패.' }));
      if (!ok) {
        await dbUpdateMatch(matchId, { status: 'declined' });
        memMatches.delete(matchId);
      }
      return;
    }

    // 수락/거절 버튼 처리(후보 → 요청자 → 방생성)
    if (i.isButton() && i.customId.startsWith('match:')) {
      const [, matchId, action] = i.customId.split(':');
      const m = memMatches.get(matchId);
      if (!m) return i.reply({ content: '만료되었거나 알 수 없는 요청입니다.' });

      // 후보 쪽
      if (action === 'cand_decline') {
        if (i.user.id !== m.candidateId) return i.reply({ content: '이 버튼은 제안을 받은 사람만 누를 수 있어요.' });
        await i.update({ embeds: [new EmbedBuilder().setTitle('☕ 커피챗 제안').setColor(0xd83c3e).setDescription('❌ 거절하셨습니다.')], components: [] });
        await notifyOrFallback(m.requesterId, { content: `❌ <@${m.candidateId}> 님이 제안을 거절했어요.` });
        try { await dbUpdateMatch(matchId, { status: 'declined' }); } catch {}
        memMatches.delete(matchId);
        return;
      }

      if (action === 'cand_accept') {
        if (i.user.id !== m.candidateId) return i.reply({ content: '이 버튼은 제안을 받은 사람만 누를 수 있어요.' });
        m.candAccepted = true; memMatches.set(matchId, m);
        await i.update({ embeds: [new EmbedBuilder().setTitle('☕ 커피챗 제안').setColor(0x2b8a3e).setDescription('✅ 수락하셨습니다! 요청자의 최종 수락을 기다리는 중…')], components: [] });
        try { await dbUpdateMatch(matchId, { status: 'cand_accepted' }); } catch {}

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`match:${matchId}:req_accept`).setLabel('최종 수락').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`match:${matchId}:req_decline`).setLabel('거절').setStyle(ButtonStyle.Danger),
        );
        await notifyOrFallback(m.requesterId, { content: `✅ <@${m.candidateId}> 님이 제안을 **수락**했습니다. 최종 수락하시겠어요?`, components: [confirmRow] });
        return;
      }

      // 요청자 쪽
      if (action === 'req_decline') {
        if (i.user.id !== m.requesterId) return i.reply({ content: '이 버튼은 요청자만 누를 수 있어요.' });
        await i.update({ content: '❌ 최종 거절 처리했습니다.', components: [] });
        await notifyOrFallback(m.candidateId, { content: `❌ <@${m.requesterId}> 님이 최종 거절했습니다.` });
        try { await dbUpdateMatch(matchId, { status: 'declined' }); } catch {}
        memMatches.delete(matchId);
        return;
      }

      if (action === 'req_accept') {
        if (i.user.id !== m.requesterId) return i.reply({ content: '이 버튼은 요청자만 누를 수 있어요.' });
        m.reqAccepted = true; memMatches.set(matchId, m);
        await i.update({ content: '✅ 최종 수락 완료! 방을 자동으로 생성합니다…', components: [] });

        if (m.candAccepted && m.reqAccepted) {
          try {
            const { voice } = await createVoiceRoomAuto(matchId, m.guildId, m.requesterId, m.candidateId);
            await notifyOrFallback(m.requesterId, { content: `🔊 보이스룸이 열렸습니다: **${voice.name}** (2일 유지)` });
            await notifyOrFallback(m.candidateId, { content: `🔊 보이스룸이 열렸습니다: **${voice.name}** (2일 유지)` });
          } catch (err) {
            console.error('Voice room create error:', err?.message || err);
            await notifyOrFallback(m.requesterId, { content: `⚠️ 보이스 채널 생성 실패: ${err?.message || '권한/상위 카테고리 확인'}` });
            await notifyOrFallback(m.candidateId, { content: `⚠️ 보이스 채널 생성 실패: ${err?.message || '권한/상위 카테고리 확인'}` });
          } finally {
            memMatches.delete(matchId);
          }
        } else {
          await i.followUp({ content: '상대의 수락을 기다리는 중…' });
        }
        return;
      }
    }
  } catch (err) {
    console.error('Interaction error:', err?.message || err);
    if (i && !i.replied && !i.deferred) { try { await i.reply({ content: '처리 중 오류가 발생했습니다.' }); } catch {} }
  }
});

/* ========= Startup ========= */
(async () => {
  try {
    await registerCommands();
    await client.login(TOKEN);
  } catch (e) {
    console.error('Startup error:', e);
    process.exit(1);
  }
})();
