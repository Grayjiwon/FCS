import { Client, GatewayIntentBits, Partials, REST, Routes, Events } from 'discord.js';
import { cfg, assertEnv } from './config.js';
import { supabase, dbInsertMessage } from './db.js';
import { profileCommands, handleProfileInteraction } from './commands/profile.js';
import { matchCommands, handleMatchInteraction } from './commands/match.js';
import { bootstrapCommands, handleBootstrapInteraction } from './commands/bootstrap.js';
import { logErrorEvent } from './logging.js';

assertEnv();

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

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(cfg.token);
  const body = [
    ...profileCommands.map(c => c.toJSON()),
    ...matchCommands.map(c => c.toJSON()),
    ...bootstrapCommands.map(c => c.toJSON())
  ];
  if (cfg.guildId) {
    await rest.put(Routes.applicationGuildCommands(cfg.appId, cfg.guildId), { body });
    console.log('✅ Registered guild commands');
  } else {
    await rest.put(Routes.applicationCommands(cfg.appId), { body });
    console.log('✅ Registered global commands');
  }
}

/* 메시지 로깅 (추천 품질 개선용) */
client.on(Events.MessageCreate, async (m) => {
  try {
    if (!m.guildId || m.author?.bot) return;
    if (cfg.loggingWhitelist.length && !cfg.loggingWhitelist.includes(m.channelId)) return;
    if (!m.content || !m.content.trim()) return;
    await dbInsertMessage(m);
  } catch (e) {
    await logErrorEvent(client, 'message logging failed', e);
  }
});

/* 인터랙션 라우팅 */
client.on(Events.InteractionCreate, async (i) => {
  try {
    if (await handleProfileInteraction(i)) return;
    if (await handleMatchInteraction(client, i)) return;
    if (await handleBootstrapInteraction(i)) return;
  } catch (e) {
    console.error('Interaction error:', e);
    if (i && !i.replied && !i.deferred) { try { await i.reply({ content: '처리 중 오류가 발생했습니다.' }); } catch {} }
    await logErrorEvent(client, 'interaction failed', e);
  }
});

(async () => {
  try {
    await registerCommands();
    await client.login(cfg.token);
  } catch (e) {
    console.error('Startup error:', e);
    process.exit(1);
  }
})();

