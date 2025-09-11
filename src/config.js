import 'dotenv/config';

export const cfg = {
  token: process.env.DISCORD_TOKEN,
  appId: process.env.APP_ID,
  guildId: process.env.GUILD_ID,

  channels: {
    startHere: process.env.STARTHERE_CHANNEL_ID || '',
    announcements: process.env.ANNOUNCEMENTS_CHANNEL_ID || '',
    introsHub: process.env.INTROS_HUB_CHANNEL_ID || '',
    chooseRoles: process.env.CHOOSE_ROLES_CHANNEL_ID || '',
    matchFeed: process.env.MATCH_FEED_CHANNEL_ID || '',
    lobbyText: process.env.LOBBY_TEXT_CHANNEL_ID || '',
    userFeedback: process.env.USER_FEEDBACK_CHANNEL_ID || '',
    mod: process.env.MOD_CHANNEL_ID || '',
    matchLogs: process.env.MATCH_LOG_CHANNEL_ID || '',
    reportingLogs: process.env.REPORTING_LOG_CHANNEL_ID || '',
    errorLogs: process.env.ERROR_LOG_CHANNEL_ID || ''
  },

  categories: {
    coffee: process.env.COFFEE_CATEGORY_ID || ''
  },

  loggingWhitelist: (process.env.LOG_CHANNEL_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean),

  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY
  },

  gemini: {
    key: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  }
};

export function assertEnv() {
  if (!cfg.token) throw new Error('DISCORD_TOKEN missing');
  if (!cfg.appId) throw new Error('APP_ID missing');
  if (!cfg.supabase.url || !cfg.supabase.key)
    console.warn('⚠️ Supabase env not set (DB 기능 제한)');
}
