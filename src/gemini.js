import { GoogleGenerativeAI } from '@google/generative-ai';
import { cfg } from './config.js';

const genai = cfg.gemini.key ? new GoogleGenerativeAI(cfg.gemini.key) : null;

export function safeTags(arr) {
  return (Array.isArray(arr) ? arr : []).map(s => String(s).trim()).filter(Boolean).slice(0, 12);
}

function extractJson(s) {
  const fenced = s.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return s.slice(start, end + 1);
  return s.trim();
}

export async function summarizeProfileWithGemini(name, narrative) {
  if (!genai) {
    const fallback = narrative.toLowerCase();
    const tags = ['ai','ml','startup','career','fintech','product','design','marketing','security']
      .filter(t => fallback.includes(t)).map(t => t.toUpperCase());
    return {
      name: name || '이름 미상',
      purpose: (narrative || '').slice(0, 140),
      interests: tags.length ? tags : ['네트워킹'],
      intro: '관심 분야 논의 희망'
    };
  }
  const prompt = `
Return ONLY JSON for:
{ "name": string, "purpose": string, "interests": string[], "intro": string }
- purpose: 80-140 chars, concrete
- interests: 3-6 tags
- intro: one line 30-80 chars, friendly
Input:
name: ${name}
narrative:
${narrative}
  `.trim();

  const model = genai.getGenerativeModel({ model: cfg.gemini.model });
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

