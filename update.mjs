// 대한태권도협회 사이트를 읽고 AI로 격파대회 일정을 정리해 data/events.json을 갱신합니다.
import fs from "node:fs";

const SRC = "https://www.koreataekwondo.co.kr/";
const FILE = "data/events.json";
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("ANTHROPIC_API_KEY 시크릿이 없습니다."); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const html = await (await fetch(SRC, { headers: { "User-Agent": "taskforce-bot" } })).text();
const text = html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
  .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, h, t) => {
    try { return ` ${t} [${new URL(h, SRC).href}] `; } catch { return ` ${t} `; }
  })
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 60000);

const prompt = `오늘은 ${today}입니다. 아래는 대한태권도협회 사이트 텍스트입니다.
여기서 중학교·고등학교·대학교 "격파" 대회(품새·겨루기 제외)만 찾아 JSON 배열로만 답하세요.
각 항목: {"name","division"("중등부"|"고등부"|"대학부"),"date"("YYYY-MM-DD"),"venue","deadline"("YYYY-MM-DD" 또는 null),"url"(공고 링크)}
글에 없는 값은 지어내지 말고 null로 두세요. 대회가 없으면 []만 답하세요.

${text}`;

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
});
if (!res.ok) { console.error("AI 호출 실패", res.status, await res.text()); process.exit(1); }
const out = (await res.json()).content.map(c => c.text || "").join("").replace(/```json|```/g, "").trim();
const found = JSON.parse(out);

const DIV = ["중등부", "고등부", "대학부"], DATE = /^\d{4}-\d{2}-\d{2}$/;
const prev = JSON.parse(fs.readFileSync(FILE, "utf8")).events.filter(e => !e.sample);
const byId = new Map(prev.map(e => [e.id, e]));
for (const f of found) {
  if (!f.name || !DIV.includes(f.division) || !DATE.test(f.date || "")) continue; // 이상 데이터는 반영하지 않음
  if (f.deadline && !DATE.test(f.deadline)) f.deadline = null;
  const id = `${f.date}-${f.name}`.replace(/\s+/g, "");
  const old = byId.get(id);
  const e = { id, name: f.name, division: f.division, date: f.date, venue: f.venue || null,
    deadline: f.deadline || null, url: f.url || SRC, source: SRC, checkedAt: today,
    firstSeen: old?.firstSeen || today };
  if (old?.changedAt) e.changedAt = old.changedAt;
  if (old && (old.deadline !== e.deadline || old.venue !== e.venue)) e.changedAt = today;
  byId.set(id, e);
}
const events = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
fs.writeFileSync(FILE, JSON.stringify({ updatedAt: today, events }, null, 2));
console.log(`일정 ${events.length}건 저장`);
