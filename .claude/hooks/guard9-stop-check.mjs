#!/usr/bin/env node
// guard9-stop-check.mjs — Stop 훅
// 세션 종료 직전, Guard 9 연관 도메인 파일을 건드렸는데 이번 세션 내내 테스트/체크 명령이
// 단 한 번도 실행되지 않았다면 경고를 표시한다(v1: 경고만, 차단 없음 — 오탐 위험 때문에
// Stephen 요청대로 warning 단계로 시작).
//
// 판정 기준을 의도적으로 단순하게 잡았다: "연관 도메인이 있는 파일을 건드렸는데
// testsRun이 통째로 비어있다"만 본다. 어떤 테스트가 정확히 어느 도메인을 커버했는지까지
// 정밀 판정하려 하지 않음 — 커맨드 문자열만으로는 신뢰할 수 없는 추정이라 차라리
// 리마인더 수준으로 두는 게 오탐이 적다(2026-09-03 설계 결정).

import { DOMAIN_DEPS, readState, readStdinJson } from './guard9-lib.mjs'

const input = readStdinJson()
const sessionId = input.session_id
if (!sessionId) process.exit(0)

const state = readState(sessionId)
const domainsTouched = Object.keys(state.domainsTouched ?? {})
const hasAnyTest = (state.testsRun ?? []).length > 0

const domainsWithDependents = domainsTouched.filter(
  (d) => (DOMAIN_DEPS[d]?.dependents.length ?? 0) > 0,
)

if (domainsWithDependents.length > 0 && !hasAnyTest) {
  const lines = domainsWithDependents.map((d) => {
    const info = DOMAIN_DEPS[d]
    const depLabels = info.dependents.map((x) => DOMAIN_DEPS[x]?.label ?? x).join(', ')
    return `  · ${info.label} 수정 → 연관: ${depLabels} (${info.reason})`
  })

  const msg =
    `[Guard 9 경고] 이번 세션에서 아래 도메인 파일을 수정했지만, ` +
    `테스트/타입체크 명령(vitest·npm run test·npm run check 등)이 한 번도 실행된 기록이 없습니다:\n` +
    lines.join('\n') +
    `\n연관 도메인 회귀 여부를 확인했는지 다시 점검해 주세요. (비차단 경고 — v1)`

  process.stdout.write(JSON.stringify({ systemMessage: msg }))
}

process.exit(0)
