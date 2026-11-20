// 공휴일 목록 파일(holidays.json) 만들기
// 공공데이터포털 '한국천문연구원_특일 정보'에서 공휴일을 받아 holidays.json으로 저장한다.
// 깃허브 자동 실행(.github/workflows/holidays.yml)이 매주 실행한다. 인증키는 깃허브 비밀 설정 HOLIDAY_API_KEY에서 읽는다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = (process.env.HOLIDAY_API_KEY || '').trim();
if (!KEY) { console.error('인증키가 없습니다. 저장소 Settings → Secrets and variables → Actions에 HOLIDAY_API_KEY를 넣어 주세요.'); process.exit(1); }

const API = process.env.HOLIDAY_API_URL || 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const OUT = 'holidays.json';
// 인증키가 이미 주소용으로 바뀐 형태(% 포함)면 그대로, 아니면 주소용으로 바꿔서 붙인다
const keyParam = /%[0-9A-Fa-f]{2}/.test(KEY) ? KEY : encodeURIComponent(KEY);

// 한국 날짜 기준 올해
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const thisYear = Number(today.slice(0, 4));
const YEARS = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchYear(year) {
  const url = `${API}?serviceKey=${keyParam}&solYear=${year}&numOfRows=100&pageNo=1&_type=json`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch {
        // 오류일 때는 JSON이 아닌 글(XML)로 답이 온다. 인증키가 섞여 나오지 않게 오류 이름만 뽑는다
        const why = (text.match(/<returnAuthMsg>([^<]*)</) || text.match(/<errMsg>([^<]*)</) || [])[1];
        throw new Error(`특일 정보가 오류로 답했습니다(HTTP ${res.status})${why ? ': ' + why : ''}`);
      }
      const header = data?.response?.header;
      if (!header || header.resultCode !== '00') throw new Error(`특일 정보 오류: ${header?.resultCode} ${header?.resultMsg}`);
      const body = data.response.body || {};
      let items = body.items?.item ?? [];
      if (!Array.isArray(items)) items = [items];
      if (Number(body.totalCount) > items.length) throw new Error(`${year}년 자료가 한 번에 다 오지 않았습니다(${items.length}/${body.totalCount}).`);
      return items
        .filter(i => i && i.isHoliday === 'Y' && /^\d{8}$/.test(String(i.locdate)))
        .map(i => { const d = String(i.locdate); return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, name: String(i.dateName || '').trim() }; });
    } catch (e) {
      lastErr = e;
      console.log(`${year}년 ${attempt}번째 시도 실패: ${e.message}`);
      await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

const all = [];
const years = [];
for (const y of YEARS) {
  let list;
  try { list = await fetchYear(y); }
  catch (e) { console.error(`공휴일을 받지 못해 저장하지 않습니다: ${e.message}`); process.exit(1); }
  console.log(`${y}년: 공휴일 ${list.length}일`);
  if (list.length) { years.push(y); all.push(...list); }
  await sleep(500);
}

// 같은 날짜·이름은 한 번만, 날짜순
const seen = new Set();
const holidays = all
  .filter(h => { const k = h.date + '|' + h.name; if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

// 이상한 결과로 덮어쓰지 않기: 올해 공휴일이 10일도 안 되면 그만둔다
const thisYearCount = holidays.filter(h => h.date.startsWith(String(thisYear))).length;
if (thisYearCount < 10) { console.error(`올해(${thisYear}) 공휴일이 ${thisYearCount}일뿐이라 저장하지 않습니다.`); process.exit(1); }

// 지난번 파일과 비교해 달라진 점을 기록에 남긴다
if (existsSync(OUT)) {
  try {
    const old = JSON.parse(readFileSync(OUT, 'utf8'));
    const key = h => h.date + ' ' + h.name;
    const before = new Set((old.holidays || []).map(key)), after = new Set(holidays.map(key));
    const added = [...after].filter(k => !before.has(k)), removed = [...before].filter(k => !after.has(k) && years.includes(Number(k.slice(0, 4))));
    console.log(added.length ? `새로 생긴 공휴일: ${added.join(', ')}` : '새로 생긴 공휴일 없음');
    if (removed.length) console.log(`없어진 공휴일: ${removed.join(', ')}`);
  } catch { console.log('지난번 파일을 읽지 못해 비교를 건너뜁니다.'); }
}

const out = { updated: today, source: '공공데이터포털 한국천문연구원_특일 정보(공휴일 정보)', years, holidays };
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`${OUT} 저장: ${holidays.length}일 (${years.join(', ')}년)`);
