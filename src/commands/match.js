import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags
} from 'discord.js';
import { dbGetProfile, dbInsertMessage, dbInsertMatch, dbUpdateMatch } from '../db.js';
import { buildProfileEmbed } from '../profile.js';
import { rankCandidates } from '../matching.js';
import { createVoiceRoomAuto } from '../room.js';
import { cfg } from '../config.js';
import { logMatchEvent, logErrorEvent } from '../logging.js';

const eph = (p={}) => ({ ...p, flags: MessageFlags.Ephemeral });

const memMatches = new Map(); // matchId -> { requesterId, candidateId, guildId, candAccepted, reqAccepted }

async function sendDM(client, userId, payload) {
  try {
    const user = await client.users.fetch(userId);
    const dm = await user.createDM();
    return await dm.send(payload);
  } catch (e) {
    await logErrorEvent(client, `DM failed to ${userId}`, e);
    return null;
  }
}
async function notifyOrFallback(client, userId, payload) {
  const ok = await sendDM(client, userId, payload);
  if (ok) return true;
  if (cfg.channels.introsHub) {
    try {
      const hub = await client.channels.fetch(cfg.channels.introsHub);
      await hub?.send({ content: `<@${userId}> DM이 차단되어 여기로 안내합니다.` });
      return true;
    } catch {}
  }
  return false;
}

export const matchCommands = [
  new SlashCommandBuilder().setName('match').setDescription('프로필 기반으로 후보를 추천받고 제안합니다.'),
  new SlashCommandBuilder().setName('privacy').setDescription('개인정보/로그 수집 안내')
];

export async function handleMatchInteraction(client, i) {
  // /privacy
  if (i.isChatInputCommand() && i.commandName === 'privacy') {
    return i.reply(eph({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔒 개인정보/로그 수집 안내 (데모)')
          .setColor(0x5865f2)
          .setDescription([
            '- 일부 텍스트 채널의 메시지를 저장해 추천 품질을 향상합니다.',
            '- 대상 채널: ' + (cfg.loggingWhitelist.length ? cfg.loggingWhitelist.map(id => `<#${id}>`).join(', ') : '봇이 접근 가능한 텍스트 채널'),
            '- 저장소: Supabase (요청 시 삭제 가능)'
          ].join('\n'))
      ]
    }));
  }

  // /match → 후보 추천 & DM 제안
  if (i.isChatInputCommand() && i.commandName === 'match') {
    await i.deferReply(eph());

    const my = await dbGetProfile(i.user.id);
    if (!my) return i.editReply({ content: '먼저 `/profile_ai`로 프로필을 생성/확정해 주세요.' });
    my.__userId = i.user.id;

    const ranked = await rankCandidates(my, i.guild, !!cfg.supabase.url);
    if (!ranked.length) return i.editReply({ content: '추천 가능한 후보가 없습니다. 다른 멤버들도 /profile_ai 를 사용하도록 안내해 주세요.' });

    const top = ranked[0];
    const member = await i.guild.members.fetch(top.userId).catch(() => null);
    const candidateName = member ? member.user.username : `사용자(${top.userId})`;

    const preview = buildProfileEmbed(top.p, `🔎 추천 후보(미리보기): ${candidateName}`)
      .addFields({ name: '매칭 상세', value: `관심사 유사도: ${(top.details.interestScore*100|0)}%\n목적 유사도: ${(top.details.purposeScore*100|0)}%` });

    await i.editReply({ content: `이 후보에게 DM으로 제안을 보낼게요.`, embeds: [preview] });

    const matchId = `m_${Date.now()}_${Math.floor(Math.random()*9999)}`;
    memMatches.set(matchId, { requesterId: i.user.id, candidateId: top.userId, guildId: i.guild.id, candAccepted: false, reqAccepted: false });
    await dbInsertMatch({ id: matchId, requesterId: i.user.id, candidateId: top.userId, guildId: i.guild.id, status: 'proposed' });
    await logMatchEvent(client, 'proposed', { matchId, requesterId: i.user.id, candidateId: top.userId });

    const dmEmbed = new EmbedBuilder()
      .setTitle('☕ 커피챗 제안')
      .setColor(0x43b581)
      .setDescription(`안녕하세요! <@${i.user.id}> 님이 커피챗을 제안했어요.\n아래 정보를 보고 **수락/거절**을 눌러 주세요.`)
      .addFields(
        { name: '요청자', value: `<@${i.user.id}>`, inline: true },
        { name: '요청자 한줄소개', value: my.intro || '-', inline: true },
        { name: '요청자 목적', value: my.purpose || '-', inline: false },
        { name: '요청자 관심사', value: (my.interests || []).join(' · ') || '-', inline: false },
      );

    const actions = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`match:${matchId}:cand_accept`).setLabel('수락').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`match:${matchId}:cand_decline`).setLabel('거절').setStyle(ButtonStyle.Danger)
    );

    const ok = await notifyOrFallback(client, top.userId, { embeds: [dmEmbed], components: [actions] });
    await i.followUp(eph({ content: ok ? '✅ 후보에게 제안을 보냈어요. 응답 대기…' : '⚠️ 후보 DM/폴백 모두 실패.' }));
    if (!ok) {
      await dbUpdateMatch(matchId, { status: 'declined' });
      await logMatchEvent(client, 'declined', { matchId, requesterId: i.user.id, candidateId: top.userId });
      memMatches.delete(matchId);
    }
    return true;
  }

  // 후보/요청자 버튼 처리
  if (i.isButton() && i.customId.startsWith('match:')) {
    const [, matchId, action] = i.customId.split(':');
    const m = memMatches.get(matchId);
    if (!m) return i.reply({ content: '만료되었거나 알 수 없는 요청입니다.' });

    // 후보 거절
    if (action === 'cand_decline') {
      if (i.user.id !== m.candidateId) return i.reply({ content: '제안을 받은 사람만 누를 수 있어요.' });
      await i.update({ embeds: [new EmbedBuilder().setTitle('☕ 커피챗 제안').setColor(0xd83c3e).setDescription('❌ 거절하셨습니다.')], components: [] });
      await notifyOrFallback(client, m.requesterId, { content: `❌ <@${m.candidateId}> 님이 제안을 거절했어요.` });
      await dbUpdateMatch(matchId, { status: 'declined' });
      await logMatchEvent(client, 'declined', { matchId, requesterId: m.requesterId, candidateId: m.candidateId });
      memMatches.delete(matchId);
      return true;
    }

    // 후보 수락 → 요청자 최종 수락 요청
    if (action === 'cand_accept') {
      if (i.user.id !== m.candidateId) return i.reply({ content: '제안을 받은 사람만 누를 수 있어요.' });
      m.candAccepted = true; memMatches.set(matchId, m);
      await i.update({ embeds: [new EmbedBuilder().setTitle('☕ 커피챗 제안').setColor(0x2b8a3e).setDescription('✅ 수락하셨습니다! 요청자의 최종 수락을 기다리는 중…')], components: [] });
      await dbUpdateMatch(matchId, { status: 'cand_accepted' });
      await logMatchEvent(client, 'cand_accepted', { matchId, requesterId: m.requesterId, candidateId: m.candidateId });

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`match:${matchId}:req_accept`).setLabel('최종 수락').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`match:${matchId}:req_decline`).setLabel('거절').setStyle(ButtonStyle.Danger)
      );
      await notifyOrFallback(client, m.requesterId, { content: `✅ <@${m.candidateId}> 님이 제안을 **수락**했습니다. 최종 수락하시겠어요?`, components: [confirmRow] });
      return true;
    }

    // 요청자 최종 거절
    if (action === 'req_decline') {
      if (i.user.id !== m.requesterId) return i.reply({ content: '요청자만 누를 수 있어요.' });
      await i.update({ content: '❌ 최종 거절 처리했습니다.', components: [] });
      await notifyOrFallback(client, m.candidateId, { content: `❌ <@${m.requesterId}> 님이 최종 거절했습니다.` });
      await dbUpdateMatch(matchId, { status: 'declined' });
      await logMatchEvent(client, 'declined', { matchId, requesterId: m.requesterId, candidateId: m.candidateId });
      memMatches.delete(matchId);
      return true;
    }

    // 요청자 최종 수락 → 보이스룸 생성
    if (action === 'req_accept') {
      if (i.user.id !== m.requesterId) return i.reply({ content: '요청자만 누를 수 있어요.' });
      m.reqAccepted = true; memMatches.set(matchId, m);
      await i.update({ content: '✅ 최종 수락 완료! 방을 자동으로 생성합니다…', components: [] });

      if (m.candAccepted && m.reqAccepted) {
        try {
          const voice = await createVoiceRoomAuto(client, {
            matchId, guildId: m.guildId, requesterId: m.requesterId, candidateId: m.candidateId
          });
          await logMatchEvent(client, 'confirmed', { matchId, requesterId: m.requesterId, candidateId: m.candidateId, voiceChannelId: voice.id });
          await notifyOrFallback(client, m.requesterId, { content: `🔊 보이스룸이 열렸습니다: **${voice.name}** (2일 유지)` });
          await notifyOrFallback(client, m.candidateId, { content: `🔊 보이스룸이 열렸습니다: **${voice.name}** (2일 유지)` });
        } catch (err) {
          await logErrorEvent(client, 'voice channel create failed', err);
          await notifyOrFallback(client, m.requesterId, { content: `⚠️ 보이스 채널 생성 실패: ${err?.message || '권한/카테고리 확인'}` });
          await notifyOrFallback(client, m.candidateId, { content: `⚠️ 보이스 채널 생성 실패: ${err?.message || '권한/카테고리 확인'}` });
        } finally {
          memMatches.delete(matchId);
        }
      } else {
        await i.followUp({ content: '상대의 수락을 기다리는 중…' });
      }
      return true;
    }
  }

  return false;
}

