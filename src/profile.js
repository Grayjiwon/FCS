import { EmbedBuilder } from 'discord.js';
import { summarizeProfileWithGemini, safeTags } from './gemini.js';

export function buildProfileEmbed(p, title = '👤 프로필') {
  return new EmbedBuilder()
    .setTitle(title).setColor(0x5865f2)
    .addFields(
      { name: '이름', value: p.name || '-', inline: true },
      { name: '한줄 소개', value: p.intro || '-', inline: true },
      { name: '관심사', value: safeTags(p.interests).join(' · ') || '-', inline: false },
      { name: '커피챗 목적', value: p.purpose || '-', inline: false }
    );
}

export { summarizeProfileWithGemini, safeTags };

