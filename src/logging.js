import { EmbedBuilder } from 'discord.js';
import { cfg } from './config.js';

export async function logTo(client, channelId, payload) {
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    await ch?.send(payload);
  } catch {}
}

export async function logMatchEvent(client, kind, data) {
  await logTo(client, cfg.channels.matchLogs, {
    embeds: [ new EmbedBuilder()
      .setTitle(`📄 match/${kind}`)
      .setColor(0x2f3136)
      .addFields(
        { name: 'match_id', value: String(data.matchId || '-') },
        { name: 'requester', value: data.requesterId ? `<@${data.requesterId}>` : '-', inline: true },
        { name: 'candidate', value: data.candidateId ? `<@${data.candidateId}>` : '-', inline: true },
        { name: 'voice', value: data.voiceChannelId ? `<#${data.voiceChannelId}>` : '-', inline: true }
      )
      .setTimestamp(new Date())
    ]
  });
}

export async function logErrorEvent(client, msg, err) {
  await logTo(client, cfg.channels.errorLogs, {
    embeds: [ new EmbedBuilder()
      .setTitle('⚠️ error')
      .setColor(0xd83c3e)
      .setDescription(msg || 'error')
      .addFields({ name: 'detail', value: String(err?.message || err || '(no detail)').slice(0, 1024) })
      .setTimestamp(new Date())
    ]
  });
}

