#!/usr/bin/env node
/* HiGHS(WASM) 두 파일을 node_modules 에서 public/solver/ 로 옮겨 놓는다.

   워커는 번들러를 거치지 않는 정적 파일이다(public/solver/worker.js · importScripts).
   그래서 highs.js · highs.wasm 도 같은 폴더에 **정적 파일로** 놓여 있어야 한다 —
   dev 서버든 빌드본이든 `<base>/solver/highs.wasm` 한 자리에서 받는다.

   3.4MB 라 커밋하지 않는다(.gitignore). 대신 postinstall · predev · prebuild 에서
   매번 돌린다 — 크기가 같으면 건너뛰므로 두 번째부터는 사실상 공짜다.

   돌리기: cd app && node scripts/copy-highs.mjs */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* import.meta.dirname 은 Node 20.11 부터다 — postinstall 이 그보다 낮은 Node 에서 서면 안 된다 */
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(APP, 'node_modules', 'highs', 'build')
const DST = path.join(APP, 'public', 'solver')
const FILES = ['highs.js', 'highs.wasm']

if (!fs.existsSync(SRC)) {
  /* 설치 전이거나 highs 를 뺐다 — 여기서 빌드를 세우지는 않는다.
     솔버가 없으면 화면은 「엔진 배치」로 돌아간다(io/solver.ts). */
  console.warn(`copy-highs: ${SRC} 가 없다 — 건너뛴다 (npm i 뒤에 다시 돈다)`)
  process.exit(0)
}

fs.mkdirSync(DST, { recursive: true })
for (const f of FILES) {
  const from = path.join(SRC, f)
  const to = path.join(DST, f)
  const a = fs.statSync(from)
  const b = fs.existsSync(to) ? fs.statSync(to) : null
  if (b && b.size === a.size) continue
  fs.copyFileSync(from, to)
  console.log(`copy-highs: public/solver/${f} ← node_modules/highs/build/${f} (${a.size}B)`)
}
