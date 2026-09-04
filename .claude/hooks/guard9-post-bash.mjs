#!/usr/bin/env node
// guard9-post-bash.mjs — PostToolUse(Bash) 훅
// 이번 세션에서 테스트/타입체크성 명령이 실행됐는지 세션 상태파일에 조용히 기록한다.
// guard9-stop-check.mjs가 세션 종료 시 이 기록을 근거로 "회귀검사 흔적 없음" 경고 여부를 판단.
// 사용자에게 아무 것도 출력하지 않음(항상 exit 0, 무음).

import { readState, writeState, readStdinJson } from './guard9-lib.mjs'

const TEST_CMD_RE = /\b(vitest|npm run test|npm test|npm run check|svelte-check)\b/i

const input = readStdinJson()
const sessionId = input.session_id
const command = input.tool_input?.command ?? ''

if (sessionId && TEST_CMD_RE.test(command)) {
  const state = readState(sessionId)
  state.testsRun ??= []
  state.testsRun.push({ command, ts: new Date().toISOString() })
  writeState(sessionId, state)
}

process.exit(0)
