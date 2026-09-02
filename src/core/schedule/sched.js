/* ===========================================================
   면접 일정 자동 편성 엔진
   우선순위: 1) 학력 요일 분리  2) 팀 시간대 중복 금지
             3) 동일 팀 연속 배치  4) 첫 타임 수요 적은 조부터
   =========================================================== */
(function (root) {
  const EDU_ORDER = ['학사', '석사', '박사'];

  const DEFAULT_CFG = {
    startDate: '2026-08-17',
    days: 0,               // 0 = 자동 계산
    sessions: 14,          // 1일 세션 수 — 08:00~17:00 정원(오전 7 + 오후 7). 현행 운영은 8
    rooms: 4,              // 병렬 조 수 — 숫자 | {학사:3,석사:2,박사:1} | 'auto'(학력 블록별 자동 산출)
    startTime: '08:00',
    sessionMin: 30,        // 면접 시간
    breakMin: 5,           // 세션 간 휴식
    lunchStart: '12:00',
    lunchMin: 60,
    amSessions: 7,         // 오전 세션 수 (나머지는 오후)
    separateEdu: true,     // ① 학력 분리 적용 여부
    eduBoundary: 'session',// ① 분리 단위 — 'session'(시간축 연속 블록) | 'day'(날짜 통째로 분리)
    checkInterviewer: true,// ② 면접관 개인 단위 중복 검사
    avoidFirstSlot: 'soft',// ④ 첫 타임 회피 — 'off' | 'soft'(가점) | 'hard'(공석 허용)
    rotateEvery: 4,        // 면접관 교대 주기(연속 세션) — 안내용
    skipWeekend: true,     // 토·일 건너뛰기 (공휴일은 미처리)
    pinned: null           // 증분 재편성 — [{id,day,slot,room}] 확정 통보분을 고정한다
  };

  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const toHM = v => String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');

  /* 세션 시각표 계산 — 점심 구간을 건너뛰며 순차 배치 */
  function buildTimes(cfg) {
    const ls = toMin(cfg.lunchStart), le = ls + cfg.lunchMin;
    const am = Math.max(0, Math.min(cfg.sessions, cfg.amSessions));
    const out = [];
    let cur = toMin(cfg.startTime);
    for (let i = 0; i < cfg.sessions; i++) {
      if (i === am) cur = le;                                 // 오후는 점심 종료 후 시작
      if (i < am && cur + cfg.sessionMin > ls) cur = le;       // 오전이 점심을 침범하면 오후로
      out.push({ i, start: cur, end: cur + cfg.sessionMin,
                 label: toHM(cur) + '–' + toHM(cur + cfg.sessionMin), pm: cur >= le });
      cur += cfg.sessionMin + cfg.breakMin;
    }
    return out;
  }

  function firstSlots(times) {
    const am = 0;
    const pmIdx = times.findIndex(t => t.pm);
    return { am, pm: pmIdx };
  }

  /* offset번째 면접일. skipWeekend면 토·일을 건너뛴 영업일 기준으로 센다.
     시작일 자체가 주말이면 다음 월요일로 민다. 공휴일은 데이터가 없어 처리하지 않는다(A-10). */
  function dateOf(startDate, offset, skipWeekend) {
    const d = new Date(startDate + 'T00:00:00');
    if (skipWeekend) {
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      for (let i = 0; i < offset; i++) {
        do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
      }
    } else {
      d.setDate(d.getDate() + offset);
    }
    const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { iso, wd, label: `${d.getMonth() + 1}/${d.getDate()}(${wd})` };
  }

  /* 물리적 최소 소요일 — ② 제약상 한 팀이 하루에 소화할 수 있는 면접은 1일 세션 수가 상한이다.
     조를 아무리 늘려도 이 값 밑으로는 내려가지 않는다. */
  function minDays(apps, cfgIn) {
    const cfg = Object.assign({}, DEFAULT_CFG, cfgIn || {});
    const dem = {};
    apps.forEach(a => a.teams.forEach(t => dem[t] = (dem[t] || 0) + 1));
    const vals = Object.values(dem);
    if (!vals.length) return 0;
    const top = Math.max(...vals);
    const team = Object.keys(dem).find(t => dem[t] === top);
    return { days: Math.ceil(top / cfg.sessions), team, requests: top, sessions: cfg.sessions };
  }

  /* 연속 블록 추출 — 같은 날·같은 조·같은 팀이면서 세션이 이어지면 한 블록.
     ③ 제약의 존재 이유(Webex 입·퇴장 최소화)에 맞춰 링크를 블록 단위로 붙이기 위한 순수 함수.
     placed를 읽기만 하므로 배치 결과에 영향을 주지 않는다. */
  function blocksOf(placed) {
    const by = {};
    placed.forEach(p => {
      const k = `${p.day}|${p.room}|${p.team}`;
      (by[k] = by[k] || []).push(p);
    });
    const out = [];
    Object.keys(by).sort().forEach(k => {
      const [day, room, team] = k.split('|');
      const list = by[k].sort((a, b) => a.slot - b.slot);
      let cur = null;
      list.forEach(p => {
        if (cur && p.slot === cur.slotTo + 1) { cur.slotTo = p.slot; cur.apps.push(p); return; }
        cur = { day: +day, room: +room, team, slotFrom: p.slot, slotTo: p.slot, apps: [p] };
        out.push(cur);
      });
    });
    return out.sort((a, b) => a.day - b.day || a.slotFrom - b.slotFrom || a.room - b.room);
  }

  /* 학력 블록별 조 수 자동 산출 — 여유 세션을 써서 피크 조 수를 최소화한다 */
  function autoRooms(apps, cfg) {
    const S = cfg.sessions;
    const N = {}, floorL = {};
    EDU_ORDER.forEach(e => {
      const list = apps.filter(a => a.edu === e);
      if (!list.length) return;
      N[e] = list.length;
      const c = {}; list.forEach(a => a.teams.forEach(t => c[t] = (c[t] || 0) + 1));
      floorL[e] = Math.max(...Object.values(c));      // ② — 한 팀이 필요한 최소 세션 수
    });
    const dem = {}; apps.forEach(a => a.teams.forEach(t => dem[t] = (dem[t] || 0) + 1));
    const dMin = Math.ceil(Math.max(...Object.values(dem)) / S);
    const budget = (cfg.days > 0 ? cfg.days : dMin) * S;
    const keys = Object.keys(N);
    const cap = Math.max(1, cfg.maxRooms || Math.max(...keys.map(e => N[e])));
    const opts = keys.map(e => {
      const seen = {}, arr = [];
      for (let R = 1; R <= cap; R++) {
        const L = Math.max(Math.ceil(N[e] / R), floorL[e]);
        if (seen[L]) continue; seen[L] = 1; arr.push({ e, R, L });
        if (L === floorL[e]) break;              // 더 늘려도 세션이 안 줄면 중단
      }
      return arr;
    });
    /* 예산(=목표 일수 × 세션) 안에서 피크 조 수를 최소화. 불가능하면 하루씩 늘려 재시도 */
    let best = null, bud = budget, days = Math.max(1, Math.round(budget / S));
    for (let attempt = 0; attempt < 40 && !best; attempt++, bud += S, days++) {
      const rec = (i, cur, used) => {
        if (used > bud) return;
        if (i === keys.length) {
          const peak = Math.max(...cur.map(x => x.R));
          const res = cur.reduce((a, x) => a + x.R * x.L, 0);
          if (!best || peak < best.peak || (peak === best.peak && res < best.res)) best = { peak, res, days, cur: cur.slice() };
          return;
        }
        for (const o of opts[i]) rec(i + 1, cur.concat(o), used + o.L);
      };
      rec(0, [], 0);
    }
    if (!best) return null;
    const map = {}; best.cur.forEach(x => map[x.e] = x.R);
    return { map, peak: best.peak, res: best.res, dMin, days: best.days };
  }

  /* 후보 슬롯 비용 — ③ 연속 배치(가중치 큼) > ④ 첫 타임 회피(작음) */
  function scoreSlot(d, r, s, L, home, avoidFirst, FS, afMode) {
    let cost = 0;
    if (L && L.d === d && L.r === r && s === L.s + 1) cost += 0;
    else if (L && L.d === d && L.r === r) cost += 30;
    else if (L && L.d === d) cost += 45;
    else cost += 55;
    if (avoidFirst && afMode !== 'off' && (s === FS.am || s === FS.pm)) cost += 22;
    return cost + d * 6 + (r === home ? 0 : 4) + s * 0.1;
  }

  /* ---------- 메인 편성 ---------- */
  function schedule(apps, cfgIn) {
    const cfg = Object.assign({}, DEFAULT_CFG, cfgIn || {});
    const times = buildTimes(cfg);
    const FS = firstSlots(times);
    const S = cfg.sessions;
    let roomsPlan = null;
    if (cfg.rooms === 'auto') { roomsPlan = autoRooms(apps, cfg); }
    else if (typeof cfg.rooms === 'object' && cfg.rooms) { roomsPlan = { map: cfg.rooms }; }
    const roomsFor = e => roomsPlan ? (roomsPlan.map[e] || 1) : cfg.rooms;
    const R = roomsPlan ? Math.max(...Object.values(roomsPlan.map)) : cfg.rooms;   // 피크(격자 폭)

    /* 팀 수요 = 면접 참여 건수 (합동면접은 양 팀 모두 카운트) */
    const demand = {};
    apps.forEach(a => a.teams.forEach(t => demand[t] = (demand[t] || 0) + 1));
    const teamsAsc = Object.keys(demand).sort((a, b) => demand[a] - demand[b] || a.localeCompare(b));
    const rank = {}; teamsAsc.forEach((t, i) => rank[t] = i);
    const minDemand = demand[teamsAsc[0]];

    /* ① 학력 그룹별 요일 분리 */
    const groups = [];
    if (cfg.separateEdu) {
      EDU_ORDER.forEach(e => {
        const list = apps.filter(a => a.edu === e);
        if (list.length) groups.push({ edu: e, list });
      });
    } else {
      groups.push({ edu: '전체', list: apps.slice() });
    }

    const cap = S * R;
    let dayCursor = 0, slotCursor = 0;   // slotCursor = 전역 세션 인덱스 (day*S + slot)
    const groupDays = [];

    const grid = {};          // "d|s|r" -> session
    const teamBusy = {};      // "d|s|team" -> true
    const ivBusy = {};        // "d|s|면접관" -> true
    const lastOf = {};        // team -> {d,r,s}
    const placed = [], unplaced = [];
    const bySession = cfg.separateEdu && cfg.eduBoundary === 'session';

    /* 증분 재편성 — 확정 통보된 배정을 먼저 고정(pin)한다 */
    const pinnedIds = new Set();
    if (cfg.pinned && cfg.pinned.length) {
      const byId = {}; apps.forEach(a => byId[a.id] = a);
      cfg.pinned.forEach(q => {
        const app = byId[q.id];
        if (!app) return;                               // 취소된 지원자의 핀은 버린다
        if (grid[`${q.day}|${q.slot}|${q.room}`]) return;
        const rec = { app, day: q.day, slot: q.slot, room: q.room, team: app.teams[0],
                      teams: app.teams.slice(), interviewers: (app.interviewers || []).slice(),
                      edu: app.edu, pinned: true };
        grid[`${q.day}|${q.slot}|${q.room}`] = rec;
        app.teams.forEach(tm => teamBusy[`${q.day}|${q.slot}|${tm}`] = true);
        (app.interviewers || []).forEach(iv => ivBusy[`${q.day}|${q.slot}|${iv}`] = true);
        placed.push(rec); pinnedIds.add(q.id);
      });
    }

    groups.forEach((g, gi) => {
      const Rg = roomsFor(g.edu);          // 이 학력 블록에서 쓰는 조 수
      let days, slotFrom = 0, slotTo = Infinity;
      if (bySession) {
        /* ① 시간 축 연속 블록 — 전역 세션 구간을 학력 그룹에 순서대로 배정 */
        const need = Math.max(1, Math.ceil(g.list.length / Rg));
        slotFrom = slotCursor; slotTo = slotCursor + need - 1;
        slotCursor += need;
        days = [];
        for (let d = Math.floor(slotFrom / S); d <= Math.floor(slotTo / S); d++) days.push(d);
        dayCursor = Math.max(dayCursor, days[days.length - 1] + 1);
      } else {
        days = [];
        const need = Math.max(1, Math.ceil(g.list.length / (S * Rg)));
        for (let i = 0; i < need; i++) days.push(dayCursor + i);
      }
      groupDays.push(days);
      if (bySession && pinnedIds.size) {           // 핀이 놓인 세션은 해당 학력 블록 구간에 포함시킨다
        placed.filter(x => x.pinned && x.edu === g.edu).forEach(x => {
          const g0 = x.day * S + x.slot;
          slotFrom = Math.min(slotFrom, g0); slotTo = Math.max(slotTo, g0);
          const dd = Math.floor(g0 / S); if (!days.includes(dd)) days.push(dd);
        });
        days.sort((a, b) => a - b);
        slotCursor = Math.max(slotCursor, slotTo + 1);
      }
      const inRange = (d, s) => { const g0 = d * S + s; return g0 >= slotFrom && g0 <= slotTo; };
      /* 팀별로 묶어 연속 배치 — 수요 적은 팀부터 (④) */
      const byTeam = {};
      g.list.forEach(a => { if (pinnedIds.has(a.id)) return;
        const t = a.teams[0]; (byTeam[t] = byTeam[t] || []).push(a); });
      const order = Object.keys(byTeam).sort((a, b) => demand[a] - demand[b] || a.localeCompare(b));

      order.forEach((t, oi) => {
        const home = oi % Rg;  // 조 배정은 그룹(학력 블록) 안의 순서 기준
        const afMode = cfg.avoidFirstSlot === true ? 'soft' : (cfg.avoidFirstSlot || 'off');
        const avoidFirst = afMode !== 'off' && demand[t] > minDemand;
        /* 합동면접(복수 팀)은 제약이 가장 빡빡하므로 먼저 배치 */
        byTeam[t].sort((a, b) => b.teams.length - a.teams.length);
        byTeam[t].forEach(app => {
          let best = null;
          for (const d of days) {
            for (let r = 0; r < Rg; r++) {
              for (let s = 0; s < S; s++) {
                if (grid[`${d}|${s}|${r}`]) continue;
                if (bySession && !inRange(d, s)) continue;          // ① 학력 블록 구간 밖
                /* ② 하드 제약 — 이 지원자와 엮인 모든 팀이 해당 시간대에 비어 있어야 함 */
                let clash = false;
                for (const tm of app.teams) if (teamBusy[`${d}|${s}|${tm}`]) { clash = true; break; }
                if (!clash && cfg.checkInterviewer && app.interviewers)
                  for (const iv of app.interviewers) if (ivBusy[`${d}|${s}|${iv}`]) { clash = true; break; }
                if (clash) continue;

                if (avoidFirst && afMode === 'hard' && (s === FS.am || s === FS.pm)) continue;
                const cost = scoreSlot(d, r, s, lastOf[t], home, avoidFirst, FS, afMode);
                if (!best || cost < best.cost) best = { d, r, s, cost };
              }
            }
          }
          if (!best) {                      // 남은 자리가 없으면 구간을 넓혀 재시도
            if (bySession) {                // 세션 모드 — 학력 블록을 한 세션 확장
              slotTo += 1;
              slotCursor = Math.max(slotCursor, slotTo + 1);
              const nd = Math.floor(slotTo / S);
              if (!days.includes(nd)) days.push(nd);
            } else {                        // 날짜 모드 — 하루 추가 (slotTo가 Infinity라 확장 불가)
              days.push(days[days.length - 1] + 1);
            }
            for (const d of days) {
              for (let r = 0; r < Rg; r++)
                for (let s = 0; s < S; s++) {
                  if (bySession && !inRange(d, s)) continue;
                  if (grid[`${d}|${s}|${r}`]) continue;
                  if (avoidFirst && afMode === 'hard' && (s === FS.am || s === FS.pm)) continue;
                  let clash = false;
                  for (const tm of app.teams) if (teamBusy[`${d}|${s}|${tm}`]) { clash = true; break; }
                  if (!clash && cfg.checkInterviewer && app.interviewers)
                    for (const iv of app.interviewers) if (ivBusy[`${d}|${s}|${iv}`]) { clash = true; break; }
                  if (clash) continue;
                  const c2 = scoreSlot(d, r, s, lastOf[t], home, avoidFirst, FS, afMode);
                  if (!best || c2 < best.cost) best = { d, r, s, cost: c2 };
                }
              if (best) break;
            }
          }
          if (!best) { unplaced.push(app); return; }
          const rec = { app, day: best.d, room: best.r, slot: best.s, team: t,
                        teams: app.teams.slice(), interviewers: (app.interviewers || []).slice(), edu: app.edu };
          grid[`${best.d}|${best.s}|${best.r}`] = rec;
          app.teams.forEach(tm => teamBusy[`${best.d}|${best.s}|${tm}`] = true);
          (app.interviewers || []).forEach(iv => ivBusy[`${best.d}|${best.s}|${iv}`] = true);
          lastOf[t] = { d: best.d, r: best.r, s: best.s };
          placed.push(rec);
        });
      });
      dayCursor = Math.max(dayCursor, days[days.length - 1] + 1);
    });
    const totalDays = Math.max(1, Math.min(400, cfg.days > 0 ? Math.max(cfg.days, dayCursor) : dayCursor));
    if (roomsPlan) {                       // 실측 피크·좌석 채우기
      const bySlot = {};
      placed.forEach(p => { const k = p.day + '|' + p.slot; bySlot[k] = Math.max(bySlot[k] || 0, p.room + 1); });
      roomsPlan.peak = placed.length ? Math.max(...Object.values(bySlot)) : 0;
      roomsPlan.seats = Object.values(bySlot).reduce((a, b) => a + b, 0);
    }

    return { cfg: Object.assign({}, cfg, { rooms: R }), roomsPlan, times, FS, grid, placed, unplaced, demand, teamsAsc, minDemand,
             totalDays, groupDays, groups: groups.map(g => g.edu),
             dates: Array.from({ length: totalDays }, (_, i) => dateOf(cfg.startDate, i, cfg.skipWeekend)) };
  }

  /* ---------- 제약 검증 ---------- */
  function validate(res) {
    const { cfg, placed, FS, totalDays, demand, minDemand } = res;
    const V = { r1: [], r2: [], r3: [], r4: [] };

    /* ① 학력 분리 — 같은 세션(시간대)에 학력이 섞이면 위반. 'day' 모드는 날짜 단위까지 검사 */
    const bucket = {};
    placed.forEach(p => { const k = `${p.day}|${p.slot}`; (bucket[k] = bucket[k] || new Set()).add(p.edu); });
    Object.entries(bucket).forEach(([k, set]) => {
      if (set.size > 1) { const [d, s] = k.split('|');
        V.r1.push({ day: +d, slot: +s, detail: `${+d + 1}일차 ${+s + 1}세션에 ${[...set].join('·')} 혼재` }); }
    });
    if (cfg.eduBoundary === 'day') {
      for (let d = 0; d < totalDays; d++) {
        const edus = new Set(placed.filter(p => p.day === d).map(p => p.edu));
        if (edus.size > 1) V.r1.push({ day: d, detail: `${d + 1}일차에 ${[...edus].join('·')} 혼재(날짜 분리 모드)` });
      }
    }
    /* ①-b 학력 블록 겹침 — 한 학력의 시간 구간 안에 다른 학력이 끼어들면 위반
       (빈 세션은 위반이 아니다 — 요구는 "섞이지 않게"이지 "빈틈 없이"가 아님) */
    const span = {}; placed.forEach(p => { const g0 = p.day * cfg.sessions + p.slot;
      const v = span[p.edu] || (span[p.edu] = { min: g0, max: g0 });
      v.min = Math.min(v.min, g0); v.max = Math.max(v.max, g0); });
    const eduList = Object.keys(span);
    eduList.forEach(e => {
      const bad = placed.filter(p => {
        const g0 = p.day * cfg.sessions + p.slot;
        return p.edu !== e && g0 >= span[e].min && g0 <= span[e].max; });
      if (bad.length) {
        const others = [...new Set(bad.map(p => p.edu))].join('·');
        V.r1.push({ detail: `${e} 구간(전역 ${span[e].min + 1}~${span[e].max + 1}세션) 안에 ${others} ${bad.length}건이 끼어듦` });
      }
    });
    /* ② 팀·면접관 시간대 중복 */
    const cnt = {};
    placed.forEach(p => p.teams.forEach(t => {
      const k = `${p.day}|${p.slot}|${t}`; (cnt[k] = cnt[k] || []).push(p);
    }));
    const ivc = {};
    placed.forEach(p => (p.interviewers || []).forEach(iv => {
      const k = `${p.day}|${p.slot}|${iv}`; (ivc[k] = ivc[k] || []).push(p);
    }));
    Object.entries(ivc).forEach(([k, arr]) => {
      if (arr.length > 1) { const [d, s, iv] = k.split('|');
        V.r2.push({ day: +d, slot: +s, team: iv, kind: 'interviewer',
                    detail: `${+d + 1}일차 ${+s + 1}세션에 면접관 ${iv} ${arr.length}건 중복` }); }
    });
    Object.entries(cnt).forEach(([k, arr]) => {
      if (arr.length > 1) {
        const [d, s, t] = k.split('|');
        V.r2.push({ day: +d, slot: +s, team: t,
                    detail: `${+d + 1}일차 ${+s + 1}세션에 ${t} ${arr.length}건 중복` });
      }
    });
    /* ③ 연속 배치 끊김 — 같은 날·같은 팀·같은 학력 블록 안에서 연속인지
       (학력 경계로 갈리는 것은 ①의 결과이므로 ③ 위반으로 세지 않는다) */
    const eduKinds = [...new Set(placed.map(p => p.edu))];
    for (let d = 0; d < totalDays; d++) {
     for (const ed of eduKinds) {
      const teams = new Set(placed.filter(p => p.day === d && p.edu === ed).map(p => p.team));
      teams.forEach(t => {
        const mine = placed.filter(p => p.day === d && p.edu === ed && p.team === t);
        const rooms = new Set(mine.map(p => p.room));
        if (rooms.size > 1)
          V.r3.push({ day: d, team: t, edu: ed, detail: `${d + 1}일차 ${t}(${ed})이 ${rooms.size}개 조로 분산` });
        rooms.forEach(r => {
          const sl = mine.filter(p => p.room === r).map(p => p.slot).sort((a, b) => a - b);
          for (let i = 1; i < sl.length; i++)
            if (sl[i] !== sl[i - 1] + 1)
              V.r3.push({ day: d, team: t, room: r, edu: ed,
                          detail: `${d + 1}일차 ${r + 1}조 ${t}(${ed}) — ${sl[i - 1] + 1}세션과 ${sl[i] + 1}세션 사이 끊김` });
        });
      });
     }
    }
    /* ④ 첫 타임 — 수요 최소 조 우선 */
    placed.forEach(p => {
      if ((p.slot === FS.am || p.slot === FS.pm) && demand[p.team] > minDemand)
        V.r4.push({ day: p.day, slot: p.slot, team: p.team,
                    detail: `${p.day + 1}일차 ${p.slot === FS.am ? '오전' : '오후'} 첫 타임에 ${p.team}(수요 ${demand[p.team]}명)` });
    });
    return V;
  }

  /* auto 모드 — 후보 편성안을 실제로 돌려보고 (소요일 → 자원) 순으로 고른다.
     이론 산출값만으로는 그리디가 하한을 놓칠 수 있어, 실측으로 검증한 뒤 선택한다. */
  function seatsOf(res) {
    const bySlot = {};
    res.placed.forEach(p => { const k = p.day + '|' + p.slot;
      bySlot[k] = Math.max(bySlot[k] || 0, p.room + 1); });
    return Object.values(bySlot).reduce((a, b) => a + b, 0);
  }
  function scheduleAuto(apps, cfgIn) {
    const cfg = Object.assign({}, DEFAULT_CFG, cfgIn || {});
    const plan = autoRooms(apps, Object.assign({}, cfg, { rooms: 'auto' }));
    const cands = [];
    if (plan) for (let k = 0; k <= 4; k++) {
      const m = {}; Object.keys(plan.map).forEach(e => m[e] = plan.map[e] + k);
      cands.push({ label: `가변(피크 ${plan.peak + k})`, rooms: m });
    }
    const base = plan ? plan.peak : (typeof cfg.rooms === 'number' ? cfg.rooms : 4);
    for (let R = Math.max(1, base - 1); R <= base + 4; R++) cands.push({ label: `고정 ${R}조`, rooms: R });
    let best = null;
    for (const c of cands) {
      let r; try { r = schedule(apps.map(a => Object.assign({}, a)), Object.assign({}, cfg, { rooms: c.rooms })); }
      catch (e) { continue; }
      if (r.unplaced.length) continue;
      const seats = seatsOf(r);
      const peak = Math.max(...r.placed.map(p => p.room + 1));
      const V = validate(r);
      const key = [r.totalDays, seats, V.r3.length + V.r4.length];
      if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] ||
          (key[1] === best.key[1] && key[2] < best.key[2])))) {
        r.roomsPlan = { map: typeof c.rooms === 'object' ? c.rooms : null, peak, seats, label: c.label,
                        dMin: plan ? plan.dMin : null };
        best = { r, key };
      }
    }
    return best ? best.r : schedule(apps, Object.assign({}, cfg, { rooms: base }));
  }

  const api = { DEFAULT_CFG, EDU_ORDER, schedule, scheduleAuto, validate, buildTimes, toHM, dateOf,
                autoRooms, minDays, blocksOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Sched = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
