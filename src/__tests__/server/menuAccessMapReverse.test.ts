/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  MENU_GUARDED_ENDPOINTS,
  MENU_GUARDED_SHARED_ENDPOINTS,
  MENU_GUARDED_ACTION_FILES,
  MENU_GUARDED_LOADER_FILES,
  MENU_GUARDED_CONDITIONAL_FILES,
  MENU_GUARD_FORBIDDEN_ENDPOINT_DIRS,
} from '$lib/server/menuAccessMap'

/**
 * 역방향 스캔(2-A·G1, 2026-10-06) — 매핑표 → 코드 방향 검사는 menuAccessMap.test.ts가 하고,
 * 이 파일은 반대로 "코드에 게이트가 있는데 매핑표에 없는 파일"과 "핸들러 수 ≠ 게이트 수"를 잡는다(표 갱신 누락 방지).
 */
const ROOT = process.cwd()
const GATE_SRC = '\\b(requireMenuAccessApi|requireAnyMenuAccessApi|requireMenuAccessAction|checkMenuAccess|checkAnyMenuAccess)\\('
const hasGate = (src: string): boolean => new RegExp(GATE_SRC).test(src)
const countGates = (src: string): number => (src.match(new RegExp(GATE_SRC, 'g')) ?? []).length

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (name === '+server.ts' || name === '+page.server.ts') out.push(rel)
  }
  return out
}

const mappedFiles = new Set<string>([
  ...Object.values(MENU_GUARDED_ENDPOINTS).flatMap((e) => e.dirs.map((d) => `${d}/+server.ts`)),
  ...MENU_GUARDED_SHARED_ENDPOINTS.flatMap((e) => e.dirs.map((d) => `${d}/+server.ts`)),
  ...MENU_GUARDED_ACTION_FILES.map((a) => a.file),
  ...MENU_GUARDED_LOADER_FILES.map((l) => l.file),
  ...MENU_GUARDED_CONDITIONAL_FILES.map((c) => c.file),
])

// 게이트 호출이 있어도 의도적으로 매핑표 밖인 파일(없으면 비워 둔다)
const UNMAPPED_ALLOWLIST = new Set<string>([])

const files = ['src/routes/api', 'src/routes/cms'].flatMap((d) => walk(d))

describe('역방향 스캔', () => {
  it('게이트 호출이 있는 파일은 모두 매핑표에 등록돼 있다', () => {
    const missing = files.filter((f) => hasGate(readFileSync(join(ROOT, f), 'utf-8')) && !mappedFiles.has(f) && !UNMAPPED_ALLOWLIST.has(f))
    expect(missing).toEqual([])
  })

  it('+server.ts는 export한 핸들러 수만큼 게이트를 호출한다(조건부 파일 제외)', () => {
    const bad: string[] = []
    for (const f of files.filter((x) => x.endsWith('+server.ts'))) {
      const src = readFileSync(join(ROOT, f), 'utf-8')
      const gates = countGates(src)
      if (gates === 0 || MENU_GUARDED_CONDITIONAL_FILES.some((c) => c.file === f)) continue
      const handlers = (src.match(/^export const (GET|POST|PUT|PATCH|DELETE)\b/gm) ?? []).length
      // 기존 게이트(doc-url·confirm-cancel)는 핸들러 안에서 한 번 더 확인하는 경우가 있어 "이상"으로 검사
      if (gates < handlers) bad.push(`${f} (핸들러 ${handlers}, 게이트 ${gates})`)
    }
    expect(bad).toEqual([])
  })

  it('금지 목록(고객용 chat API)에는 게이트가 없다', () => {
    for (const d of MENU_GUARD_FORBIDDEN_ENDPOINT_DIRS) {
      const f = `${d}/+server.ts`
      let src: string
      try { src = readFileSync(join(ROOT, f), 'utf-8') } catch { continue }
      expect(hasGate(src), f).toBe(false)
    }
  })
})
