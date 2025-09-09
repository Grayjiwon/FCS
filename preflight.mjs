// preflight.mjs (ESM)
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

function requireEnv(keys) {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ Missing env:', missing.join(', '));
    process.exit(1);
  }
}

(async () => {
  // 1) .env 필수값 확인
  requireEnv(['DISCORD_TOKEN','APP_ID','GUILD_ID','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']);
  if (!process.env.INTROS_HUB_CHANNEL_ID) {
    console.warn('⚠️ INTROS_HUB_CHANNEL_ID 미설정: 허브 자동 온보딩/알림 비활성');
  }

  // 2) Discord 토큰 유효성 확인
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const me = await rest.get(Routes.oauth2CurrentApplication());
    console.log('✅ Discord REST OK. App:', me?.name, `(id: ${me?.id})`);
  } catch (e) {
    console.error('❌ Discord 토큰/권한 점검 실패:', e?.message || e);
    process.exit(1);
  }

  // 3) Supabase 연결/권한 확인 (profiles 존재여부)
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error: e1 } = await supabase.from('profiles').select('user_id', { count: 'exact', head: true });
    if (e1) throw e1;
    console.log('✅ Supabase OK. `profiles` 테이블 접근 가능');
  } catch (e) {
    console.error('❌ Supabase 점검 실패:', e?.message || e);
    process.exit(1);
  }

  // 4) 간단 요약
  console.log('🎯 Preflight 완료: 이제 `npm start`로 봇을 실행해 보세요.');
})();
