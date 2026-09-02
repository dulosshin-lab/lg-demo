import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
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
