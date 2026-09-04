#!/usr/bin/env node
// guard9-post-edit.mjs — PostToolUse(Edit|Write) 훅
// 방금 수정된 파일을 Guard 9 도메인(M2/M3/M4/M5/auth)에 매핑하고, 연관 도메인이 있으면
// 즉시 컨텍스트에 리마인더를 주입한다. 비차단 — 항상 exit 0.

import { detectDomain, DOMAIN_DEPS, readState, writeState, readStdinJson } from './guard9-lib.mjs'

const input = readStdinJson()
const sessionId = input.session_id
const filePath =
  input.tool_input?.file_path ??
  input.tool_response?.filePath ??
  null

const domain = detectDomain(filePath)

if (domain && sessionId) {
  const state = readState(sessionId)
  state.domainsTouched ??= {}
  state.domainsTouched[domain] ??= []
  if (!state.domainsTouched[domain].includes(filePath)) {
    state.domainsTouched[domain].push(filePath)
  }
  writeState(sessionId, state)

  const info = DOMAIN_DEPS[domain]
  if (info && info.dependents.length > 0) {
    const depLabels = info.dependents
      .map((d) => `${d}(${DOMAIN_DEPS[d]?.label ?? d})`)
      .join(', ')
    const msg =
      `[Guard 9] 방금 수정한 파일이 "${info.label}" 도메인으로 분류됩니다 — ` +
      `middleware-guards.md 의존성 맵상 ${depLabels} 영향(${info.reason}). ` +
      `해당 연관 도메인의 회귀테스트도 이번 작업 완료 전에 확인/실행할 것.`

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: msg,
        },
      }),
    )
  }
}

process.exit(0)
