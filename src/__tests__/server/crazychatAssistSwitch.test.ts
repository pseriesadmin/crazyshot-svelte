/**
 * TDD: AI 조력 생성기(API 호출형) 비활성화 — 코드는 보존하고 진입점만 닫는다 (2026-10-08)
 * 결정(Stephen): Anthropic API는 당분간 쓰지 않는다. 나중에 쓸 수 있도록 삭제하지 않고 "비활성"으로 둔다.
 * 규칙: ① 상수 한 곳(ASSIST_ENABLED)으로 켜고 끈다 ② 꺼진 동안 모든 API 핸들러는 권한 확인 직후 503으로 끝난다
 *       ③ 화면에는 마운트하지 않는다(휴면 컴포넌트로 보존) ④ 마이그레이션은 적용 대상 폴더에 두지 않는다
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ASSIST_ENABLED, assistDisabledResponse } from '$lib/server/crazychat/assist/switch'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf-8')

describe('switch', () => {
  it('기본값은 꺼짐', () => {
    expect(ASSIST_ENABLED).toBe(false)
  })
  it('꺼진 응답은 503 + 안내 문구(비활성 사유)', async () => {
    const res = assistDisabledResponse()
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string; disabled: boolean }
    expect(body.disabled).toBe(true)
    expect(body.error).toContain('비활성')
  })
})

describe('진입점이 닫혀 있다', () => {
  it('assist API 두 파일의 모든 핸들러가 비활성 응답을 호출한다(권한 확인 뒤)', () => {
    for (const f of ['src/routes/api/cms/chat/crazychat/assist/+server.ts', 'src/routes/api/cms/chat/crazychat/assist/[runId]/rollback/+server.ts']) {
      const src = read(f)
      const handlers = (src.match(/export const (GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length
      const guards = (src.match(/if \(!ASSIST_ENABLED\) return assistDisabledResponse\(\)/g) ?? []).length
      expect(guards, f).toBe(handlers)
      // 권한 게이트가 비활성 확인보다 먼저
      expect(src.indexOf('requireMenuAccessApi(locals')).toBeLessThan(src.indexOf('if (!ASSIST_ENABLED)'))
    }
  })
  it('크레이지챗 화면은 조력 생성기를 마운트하지 않는다(휴면 컴포넌트는 보존)', () => {
    const page = read('src/routes/cms/chat/crazychat/+page.svelte')
    expect(page).not.toContain('CrazychatAssistPanel')
    expect(page).not.toContain('/assist')
    expect(existsSync(join(ROOT, 'src/lib/components/cms/CrazychatAssistPanel.svelte'))).toBe(true)
  })
  it('조력 생성기 마이그레이션은 적용 대상 폴더(supabase/migrations)에 없고 휴면 폴더에 보존된다', () => {
    const live = readdirSync(join(ROOT, 'supabase/migrations')).filter((n) => n.includes('ai_assist_runs'))
    expect(live).toEqual([])
    expect(existsSync(join(ROOT, '.claude/plan/dormant/679_ai_assist_runs.sql'))).toBe(true)
  })
  it('다시 켜는 방법 안내 문서가 있다', () => {
    expect(existsSync(join(ROOT, 'src/lib/server/crazychat/assist/README.md'))).toBe(true)
  })
})
