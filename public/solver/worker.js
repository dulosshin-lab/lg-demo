/* 하루 한 판(MILP)을 푸는 워커 — HiGHS(WASM) 한 벌을 자기 안에 들고 받은 순서대로 푼다.

   모듈 워커가 아니라 **classic 워커**다. highs.js 는 Emscripten UMD 라 `export` 문이 없어
   `import` 로는 팩토리를 못 꺼낸다 — importScripts 로 넣으면 전역 `Module` 이 그대로 잡힌다.
   .wasm 자리는 직접 알려 준다(locateFile) — 워커의 scriptDirectory, 즉 이 파일이 있는 폴더다.
   (highs.js · highs.wasm 은 scripts/copy-highs.mjs 가 이 폴더에 갖다 놓는다)

   메시지는 { day, lp, timeLimitSec } 하나에 한 판. WASM 이 아직 안 올라왔으면 큐에 쌓아 두고
   준비되는 대로 이어서 푼다 — 그래야 부르는 쪽이 ready 를 기다릴 필요가 없다.
   답은 언제나 { day, status, objective, columns, ms } (+ 실패면 error) 로 돌려준다 —
   푸는 데 실패한 날은 화면이 엔진 배치로 되돌린다. */
importScripts('./highs.js')

let highs = null
let fatal = null
const queue = []

self
  .Module({ locateFile: f => new URL('./' + f, self.location.href).href })
  .then(h => { highs = h; pump() })
  .catch(err => { fatal = String((err && err.stack) || err); pump() })

self.onmessage = ev => { queue.push(ev.data); pump() }

function pump() {
  if (!highs && !fatal) return
  while (queue.length) run(queue.shift())
}

function run(job) {
  const t0 = performance.now()
  if (fatal) {
    self.postMessage({ day: job.day, status: 'Error', objective: null, columns: {}, ms: 0, error: fatal })
    return
  }
  try {
    const sol = highs.solve(job.lp, { time_limit: job.timeLimitSec, mip_rel_gap: 0 })
    self.postMessage({
      day: job.day,
      status: sol.Status,
      /* 실행 가능해를 못 찾으면 ObjectiveValue 가 Infinity 로 온다 — 값이 아니라 「없음」이다 */
      objective: Number.isFinite(sol.ObjectiveValue) ? sol.ObjectiveValue : null,
      columns: sol.Columns || {},
      ms: performance.now() - t0,
    })
  } catch (err) {
    self.postMessage({
      day: job.day,
      status: 'Error',
      objective: null,
      columns: {},
      ms: performance.now() - t0,
      error: String((err && err.stack) || err),
    })
  }
}
