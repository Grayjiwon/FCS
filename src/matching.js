import { dbGetGuildProfilesExcept, dbRecentTexts } from './db.js';
import { safeTags } from './gemini.js';

function tokens(s='') {
  return (s||'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ')
    .split(/\s+/).filter(Boolean);
}
function setSim(a='', b='') {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter(x => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return inter/uni;
}
function jaccard(A=[], B=[]) {
  const sA = new Set(A), sB = new Set(B);
  const inter = [...sA].filter(x => sB.has(x)).length;
  const uni = new Set([...sA, ...sB]).size;
  return uni ? inter/uni : 0;
}
const uniq = (a=[]) => Array.from(new Set(a));

export function deriveTagsFromText(t='') {
  const base = ['ai','ml','llm','nlp','cv','데이터','핀테크','투자','금융','블록체인','창업','스타트업','취업','이직','백엔드','프론트엔드','ios','android','pm','디자인','마케팅','세일즈','보안','클라우드','게임','리서치','infra','devops','mle','product'];
  const lower = t.toLowerCase();
  return safeTags(base.filter(k => lower.includes(k)).map(k => k.toUpperCase()));
}

export async function rankCandidates(me, guild, supabaseEnabled = true) {
  const others = await dbGetGuildProfilesExcept(guild.id, me.__userId);
  const meTexts = supabaseEnabled ? await dbRecentTexts(guild.id, me.__userId, 500) : '';
  const meLogTags = deriveTagsFromText(meTexts);
  const meTags = uniq([...(me.interests || []), ...meLogTags]);

  const scored = [];
  for (const { user_id, p } of others) {
    const theirTexts = supabaseEnabled ? await dbRecentTexts(guild.id, user_id, 500) : '';
    const theirLogTags = deriveTagsFromText(theirTexts);
    const theirTags = uniq([...(p.interests || []), ...theirLogTags]);

    const s1 = jaccard(meTags, theirTags);
    const s2 = setSim(me.purpose || '', p.purpose || '');
    scored.push({ userId: user_id, p, score: 0.7*s1 + 0.3*s2, details: { interestScore: s1, purposeScore: s2 } });
  }
  scored.sort((a,b) => b.score - a.score);
  return scored;
}
