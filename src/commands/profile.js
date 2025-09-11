import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} from 'discord.js';
import { dbGetProfile, dbUpsertProfile } from '../db.js';
import { buildProfileEmbed, summarizeProfileWithGemini, safeTags } from '../profile.js';

const eph = (p={}) => ({ ...p, flags: MessageFlags.Ephemeral });

export const profileCommands = [
  new SlashCommandBuilder().setName('profile_ai').setDescription('이름+자유서술을 입력해 AI로 프로필 생성'),
  new SlashCommandBuilder().setName('profile_view').setDescription('내 프로필 보기'),
  new SlashCommandBuilder().setName('profile_edit').setDescription('내 프로필 수정')
];

export async function handleProfileInteraction(i) {
  // /profile_view
  if (i.isChatInputCommand() && i.commandName === 'profile_view') {
    const prof = await dbGetProfile(i.user.id);
    if (!prof) return i.reply(eph({ content: '아직 프로필이 없어요. 먼저 `/profile_ai`로 생성해 주세요.' }));
    return i.reply(eph({ content: '현재 프로필입니다.', embeds: [buildProfileEmbed(prof, '👤 내 프로필')] }));
  }

  // /profile_edit (모달)
  if (i.isChatInputCommand() && i.commandName === 'profile_edit') {
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

  // /profile_ai → 모달
  if (i.isChatInputCommand() && i.commandName === 'profile_ai') {
    const modal = new ModalBuilder().setCustomId('profile_ai:submit').setTitle('AI 프로필 입력');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('이름').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('narrative').setLabel('왜 누구를 만나고 싶은가? (자유 서술)').setStyle(TextInputStyle.Paragraph).setRequired(true))
    );
    return i.showModal(modal);
  }

  // 모달 제출(생성)
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
      new ButtonBuilder().setCustomId('profile_ai:regen').setLabel('다시 생성').setStyle(ButtonStyle.Primary)
    );
    return i.editReply({ content: 'AI 요약 결과입니다. 수정/확정/다시생성 선택', embeds: [buildProfileEmbed(prof, '🤖 AI 요약 프로필')], components: [row] });
  }

  // 수정 버튼 → 모달
  if (i.isButton() && i.customId === 'profile_ai:edit') {
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

  // 수정 제출
  if (i.isModalSubmit() && i.customId === 'profile_ai:edit_submit') {
    const p = {
      name: i.fields.getTextInputValue('name')?.trim(),
      purpose: i.fields.getTextInputValue('purpose')?.trim(),
      interests: safeTags((i.fields.getTextInputValue('interests') || '').split(',')),
      intro: i.fields.getTextInputValue('intro')?.trim()
    };
    if (!p.name || !p.purpose) return i.reply(eph({ content: '이름/목적은 필수입니다.' }));
    await dbUpsertProfile(i.guild?.id || '', i.user.id, p);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('profile_ai:confirm').setLabel('확정 저장').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('profile_ai:regen').setLabel('다시 생성').setStyle(ButtonStyle.Primary)
    );
    return i.reply(eph({ content: '수정 완료. 확정 또는 다시 생성', embeds: [buildProfileEmbed(p, '✏️ 수정된 프로필')], components: [row] }));
  }

  // 확정, 재생성
  if (i.isButton() && i.customId === 'profile_ai:confirm') {
    if (!i.deferred && !i.replied) await i.deferUpdate().catch(()=>{});
    return i.followUp(eph({ content: '✅ 프로필이 확정/저장되었습니다. 이제 `/match` 로 매칭을 받아보세요.' }));
  }
  if (i.isButton() && i.customId === 'profile_ai:regen') {
    if (!i.deferred && !i.replied) await i.deferUpdate().catch(()=>{});
    const base = await dbGetProfile(i.user.id);
    if (!base) return i.followUp(eph({ content: '먼저 /profile_ai 로 입력해 주세요.' }));
    const regenerated = await summarizeProfileWithGemini(base.name || '이름', base.purpose || base.intro || '요약 재생성');
    await dbUpsertProfile(i.guild?.id || '', i.user.id, regenerated);
    return i.followUp(eph({ content: '🔄 다시 생성 완료', embeds: [buildProfileEmbed(regenerated, '🤖 재생성 프로필')] }));
  }

  return false; // 내가 처리 안 함
}

