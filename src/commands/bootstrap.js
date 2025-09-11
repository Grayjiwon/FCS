import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} from 'discord.js';
import { cfg } from '../config.js';
import { dbGetProfile } from '../db.js';
import { buildProfileEmbed, safeTags } from '../profile.js';

const eph = (p={}) => ({ ...p, flags: MessageFlags.Ephemeral });

export const bootstrapCommands = [
  new SlashCommandBuilder()
    .setName('bootstrap_start')
    .setDescription('start-here 고정 메시지 설치(운영진)')
    .setDefaultMemberPermissions(0x20) // ManageGuild
];

export async function handleBootstrapInteraction(i) {
  if (i.isChatInputCommand() && i.commandName === 'bootstrap_start') {
    if (!cfg.channels.startHere) return i.reply(eph({ content: 'STARTHERE_CHANNEL_ID 가 .env 에 없습니다.' }));
    const ch = await i.client.channels.fetch(cfg.channels.startHere).catch(() => null);
    if (!ch) return i.reply(eph({ content: 'start-here 채널을 찾을 수 없습니다.' }));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start:profile').setLabel('프로필 만들기').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('start:view').setLabel('내 프로필 보기').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('start:edit').setLabel('내 프로필 수정').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('start:match').setLabel('매칭받기').setStyle(ButtonStyle.Success)
    );

    const msg = await ch.send({
      content:
`🎯 3줄 요약
1) /profile_ai 로 프로필을 만들고 확정하세요.
2) /match 로 매칭 제안을 받습니다. (상호 수락 시 자동 1:1 보이스룸)
3) 대화 후 #user-feedback 에서 후기를 남겨 주세요.`,
      components: [row]
    });
    try { await msg.pin(); } catch {}
    return i.reply(eph({ content: '설치 완료' }));
  }

  // 버튼 핸들러
  if (i.isButton() && i.customId === 'start:profile') {
    const modal = new ModalBuilder().setCustomId('profile_ai:submit').setTitle('AI 프로필 입력');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('이름').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('narrative').setLabel('왜 누구를 만나고 싶은가?').setStyle(TextInputStyle.Paragraph).setRequired(true))
    );
    return i.showModal(modal);
  }
  if (i.isButton() && i.customId === 'start:view') {
    const prof = await dbGetProfile(i.user.id);
    if (!prof) return i.reply(eph({ content: '아직 프로필이 없어요. /profile_ai 로 생성해 주세요.' }));
    return i.reply(eph({ content: '현재 프로필입니다.', embeds: [buildProfileEmbed(prof, '👤 내 프로필')] }));
  }
  if (i.isButton() && i.customId === 'start:edit') {
    const prof = (await dbGetProfile(i.user.id)) || {};
    const modal = new ModalBuilder().setCustomId('profile_ai:edit_submit').setTitle('프로필 수정');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('이름').setStyle(TextInputStyle.Short).setRequired(true).setValue(prof.name || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('purpose').setLabel('커피챗 목적').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(prof.purpose || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('interests').setLabel('관심사(콤마 구분)').setStyle(TextInputStyle.Short).setRequired(false).setValue(safeTags(prof.interests).join(', '))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('intro').setLabel('한줄 소개').setStyle(TextInputStyle.Short).setRequired(false).setValue(prof.intro || ''))
    );
    return i.showModal(modal);
  }
  if (i.isButton() && i.customId === 'start:match') {
    return i.reply(eph({ content: '명령어 입력: `/match`' }));
  }

  return false;
}

