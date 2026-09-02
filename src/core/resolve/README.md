# ②③ resolve — 마스터 조인 · 대상 선별

업무 5단계 중 **② 각 조직에 전달 / ③ 면접 담당자 선별**의 결과를 받아 정리하는 자리다.
`ingest` 가 만든 팀별 행 목록과 지원자 마스터를 합쳐 **편성 엔진이 먹는 모양**으로 바꾼다.

## 들어오는 것 / 나가는 것

```
ParsedMaster + TeamInput[]  ──▶  resolve()  ──▶  Payload { meta, apps, excluded }
```

`apps` 가 곧 ⑤ 편성의 입력이다. `ingest` 는 "엑셀 한 장을 행으로 만드는 것"만 알고,
합치고 걸러내는 판단은 전부 여기에 있다.

## 제외 사유 세 가지 (담당자 방침)

| 사유 | 언제 |
|---|---|
| `마스터 미존재` | 회신에는 있는데 지원자 마스터에 없다 |
| `면접관 미매칭` | 어느 팀도 면접관을 적지 않았다 |
| `학력 구분 불명(…)` | `최종학력_학교유형` 이 과정1/2/3 이 아니다 |

일부 팀만 면접관을 안 적었으면 **그 팀 요청만 버리고 지원자는 유지**한다.
버린 팀은 `dropped_teams` 에 남는다.

## 정렬이 중요하다

```
학력(학사 → 석사 → 박사) → 첫 팀 이름 → 지원자번호
```

정렬 순서가 달라지면 그리디 배치가 통째로 달라진다. 그래서 문자열 비교에 `localeCompare` 를
쓰지 않고 **코드포인트 비교(`cmp`)** 를 쓴다 — Python 의 `sorted()` 와 같은 순서를 내기 위해서다.

## 고치려면 어디를 보나

| 바꾸고 싶은 것 | 볼 곳 |
|---|---|
| 제외 규칙 | `index.ts` 의 `resolve()` 안 세 개의 `continue` |
| 학력 코드 매핑 | `index.ts` 의 `CRS` |
| 파일명 → 팀 이름 | `index.ts` 의 `teamNameOf()` |
| 정렬 기준 | `index.ts` 맨 아래 `apps.sort(...)` |
| `attrs` 에 무엇이 담기나 | `../ingest/parseMaster.ts` (마스터 전 컬럼을 그대로 보존한다) |

## 검사

```bash
npm test -- resolve
```

- `__tests__/golden.test.ts` — **핵심 게이트.** Python `legacy-server/build_apps.py build()` 출력과
  `Payload` 가 완전히 일치하는지 본다. 정렬 순서와 `attrs` 까지 포함한다.
  기준값은 `tests/golden/payload.json` (`python tests/make_golden.py` 로 다시 만든다)
- `__tests__/resolve.test.ts` — 제외 사유 · 합동면접 · 정렬 · 경고 전달 단위 검사

기대값 — 요청 109건 → 매칭 69건 · 대상 60명 · 제외 23명 · 파일 8개
