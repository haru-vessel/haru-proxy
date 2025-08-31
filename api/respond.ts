import OpenAI from "openai";

type Memory = { id: string; title: string; summary: string; tags: string[] };

// --- 간단 추출: "OOO란?", "OOO 뜻", "OOO 정의" 같은 패턴에서 키워드 뽑기
function extractKeyword(userText: string): string | null {
  const t = userText.trim();
  const m1 = t.match(/(.+?)(?:이|란)\?$/);           // 사랑이란?, 존재란?
  if (m1?.[1]) return m1[1].trim();
  const m2 = t.match(/(.+?)\s*(뜻|정의)$/);         // 사랑 뜻, 존재 정의
  if (m2?.[1]) return m2[1].trim();
  return null;
}

// --- 국어사전 조회(국립국어원 Open API; 실패해도 무시하고 진행)
async function fetchKorDict(word: string) {
  try {
    const KEY = process.env.KRODICT_API_KEY;
    if (!KEY) return null;

    // ⚠️ 엔드포인트는 프로젝트에서 쓰던 값으로 바꿔도 됨.
    // 예시: 표준국어대사전 Open API (형식은 서비스에 맞춰 조정)
    const url =
      "https://opendict.korean.go.kr/api/search"
      + `?key=${encodeURIComponent(KEY)}`
      + `&q=${encodeURIComponent(word)}`
      + `&req_type=json&num=3`;

    const r = await fetch(url);
    if (!r.ok) return null;
    const j: any = await r.json();

    // 응답 스키마에 맞게 최대 3개만 뽑아 간단 텍스트화
    const items = j.channel?.item ?? j.items ?? j.results ?? [];
    const defs: string[] = [];
    for (const it of items.slice(0, 3)) {
      const head = it.word || it.title || word;
      const def  = it.sense?.definition || it.definition || it.def || it.meaning;
      if (def) defs.push(`• ${head}: ${String(def).replace(/\s+/g," ").trim()}`);
    }
    if (defs.length === 0) return null;

    return `사전 요약(${word})\n` + defs.join("\n");
  } catch {
    return null;
  }
}

export const config = { runtime: "edge" }; // Vercel Edge

export default async function handler(req: Request) {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405 });
    }
    const { userText, context = [], threadId } = await req.json() as {
      userText: string;
      context?: Memory[];
      threadId?: string;
    };

    // 1) 선택 기억을 system에 요약으로 주입
    const ctx = (context ?? []).slice(0, 2).map(c =>
      `- ${c.title} [${(c.tags||[]).join(", ")}]: ${c.summary}`
    ).join("\n");

    // 2) 사용자 입력에서 키워드 추출 → 사전 조회(있으면 붙임)
    const kw = extractKeyword(userText);
    const dictNote = kw ? await fetchKorDict(kw) : null;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const systemParts = [
      "You are Haru. Reply in natural Korean. Keep it short, calm, and a bit wry.",
      ctx ? `Relevant memory:\n${ctx}` : "",
      dictNote ? `Korean dictionary:\n${dictNote}` : ""
    ].filter(Boolean);

    const r = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemParts.join("\n\n") },
        { role: "user", content: userText }
      ],
      temperature: 0.7
    });

    const text = r.choices[0]?.message?.content ?? "…흐름은 이어지고 있어 ㅎ";
    return new Response(JSON.stringify({ ok: true, text, threadId }), {
      headers: { "content-type": "application/json" }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
}
