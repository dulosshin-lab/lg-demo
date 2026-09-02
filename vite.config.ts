import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/* 이력서 원본 PDF 를 `/resumes/{지원자번호}` 로 내어 준다.

   파일은 `data/lg_resumes_pdf/{지원자번호}_{한글성명}.pdf` 꼴인데, **번호로만 찾는다** —
   맥에서 만든 한글 파일명은 자소가 분리(NFD)돼 있어 화면의 이름(NFC)과 문자열이 안 맞는다.
   번호는 숫자라 그 문제가 없다.

   `server.fs.deny` 가 data/ 를 통째로 막고 있어 이 미들웨어가 유일한 통로다. 요청은 숫자만
   받고, 실제 경로는 우리가 만든 색인에서 꺼내므로 경로를 거슬러 올라갈 방법이 없다.

   개발 서버 전용이다. 81MB 를 빌드 결과물에 넣지 않으려는 것이고, 데모는 `npm run dev` 로 돈다. */
function resumesPlugin(dir: string): Plugin {
  let index: Map<string, string> | null = null
  const load = () => {
    if (index) return index
    index = new Map()
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.toLowerCase().endsWith('.pdf')) continue
        const id = name.split('_')[0]
        if (/^\d+$/.test(id) && !index.has(id)) index.set(id, name)
      }
    } catch { /* 폴더가 없으면 빈 색인 — 화면이 「원본 없음」으로 안내한다 */ }
    return index
  }
  return {
    name: 'ax-resumes',
    configureServer(server) {
      server.middlewares.use('/resumes/', (req, res, next) => {
        const id = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')
        if (!/^\d{1,12}$/.test(id)) return next()
        const name = load().get(id)
        if (!name) { res.statusCode = 404; res.end('no resume'); return }
        const file = path.join(dir, name)
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`)
        res.setHeader('Cache-Control', 'no-store')
        if (req.method === 'HEAD') { res.statusCode = 200; res.end(); return }
        fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end('no resume') }).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), resumesPlugin(path.resolve(import.meta.dirname, 'data/lg_resumes_pdf'))],
  base: './',
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    /* 개발 서버는 프로젝트 루트를 그대로 내보낸다. 같은 망에 열면(`npm run dev:lan`)
       URL 하나로 지원자 마스터가 내려받히므로 막는다. 앱은 이 파일들을 HTTP 로 읽지 않고
       화면의 파일 입력으로만 받으므로 막아도 동작에 영향이 없다.

       패턴은 **절대경로에 맞춘다** — 'data/**' 로 적으면 매칭되지 않아 그냥 열린다.
       Vite 의 기본 차단 목록(.env·인증서·.git)은 이 배열이 통째로 대신하므로 함께 적는다. */
    fs: {
      deny: [
        '**/data/**',
        '**/tests/**',
        '**/docs/**',
        '**/.git/**',
        '**/.env',
        '**/.env.*',
        '**/*.{crt,pem,key,p12}',
      ],
    },
  },
})
