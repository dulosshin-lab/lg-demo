# 면접 AX · 라이트 데모 (단독 추출본)

`lg데모` 저장소에서 라이트 데모(L 시리즈)만 떼어낸 독립 프로젝트. 라이트가 곧 기본 엔트리다(`index.html` → `src/lite/main.tsx`).

## 시작

```bash
npm install   # postinstall이 HiGHS wasm을 public/solver/로 복사
npm run dev
npm test      # 78 passed
npm run build
```

## 구조

- `src/lite/` — 라이트 데모 전체 (LiteApp, 명단/편성/워크스페이스/데모 페이지, 챗봇)
- `src/core/{ingest,resolve,schedule}` — 파서·매칭·편성 엔진 (본제품에서 그대로 복사)
- `src/io/xlsx.ts` — 엑셀 읽기
- `data/` — 테스트 픽스처 (취합파일, 팀 회신 xlsx)
- `data/constraint-tests/` — 제약사항별 테스트 엑셀 (하드 ①②·소프트 ③④⑤·제외 규칙·파서 규칙).
  설명은 `docs/제약사항_정리.md`, 회귀는 `tests/constraint-cases.test.ts`
- `tests/sample_data/` — 데모 화면이 안내하는 샘플 파일
- `docs/260831_1311_면접AX_세션핸드오프.md` — 추출 시점의 마지막 핸드오프

## 원본과 달라진 점

- `app/` 중첩 제거 → 프로젝트 루트가 곧 앱 루트. `lite.html` → `index.html`.
- 의존성을 라이트가 실제 쓰는 것만 남김 (react, exceljs, highs, lucide-react). supabase·ag-grid·radix·tailwind 없음.
- `data.test.ts`의 REPO_ROOT 경로와 `artifact.test.ts`의 엔트리 검증을 새 레이아웃에 맞게 수정.
- 챗봇은 로컬 Ollama(11434)를 부른다 — 없어도 앱은 뜬다.

원본: `~/Downloads/lg데모` (git, 전체 이력 보존)
