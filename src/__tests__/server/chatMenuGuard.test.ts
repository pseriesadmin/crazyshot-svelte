/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로·상수 패턴, 사용자 입력 없음) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 1단계 1b — 상담(consulting.chat) 메뉴 권한 서버 집행: 관리자 전용 채팅 API 13개 파일(핸들러 16개)의 진입부 게이트 (2026-10-03)
 *
 * ① 소스 스캔(누락 감지): 모든 핸들러의 진입부 첫 문장이 requireMenuAccessApi(locals, 'consulting.chat') 호출
 * ② 동작: 게이트가 거부(403)하면 핸들러는 DB·세션 조회 없이 즉시 403 응답
 * ③ 고객용·겸용 엔드포인트에는 게이트가 없다(금지 목록 — menuAccessMap.test.ts가 별도 감시)
 */

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))
vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn(), sendPushToAdmins: vi.fn() }))
vi.mock('$lib/server/synonymLearning', () => ({ recordSynonymLearning: vi.fn() }))
vi.mock('$lib/server/crossLingualSynonymScan', () => ({ registerCrossLingualCandidates: vi.fn() }))

const createClientSpy = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => createClientSpy(...a) }))

const guardSpy = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({
  requireMenuAccessApi: (...a: unknown[]) => guardSpy(...a),
}))

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
const TARGETS: { file: string; methods: Method[] }[] = [
  { file: 'sessions/+server', methods: ['GET'] },
  { file: 'sessions/[id]/+server', methods: ['DELETE'] },
  { file: 'sessions/[id]/bookmarks/+server', methods: ['GET'] },
  { file: 'sessions/[id]/close/+server', methods: ['POST'] },
  { file: 'sessions/[id]/cs-record/+server', methods: ['GET', 'POST', 'DELETE'] },
  { file: 'sessions/[id]/join/+server', methods: ['POST'] },
  { file: 'sessions/[id]/manual-mode/+server', methods: ['PATCH'] },
  { file: 'sessions/[id]/pending/+server', methods: ['POST'] },
  { file: 'sessions/[id]/reopen/+server', methods: ['POST'] },
  { file: 'admin-reply/+server', methods: ['POST'] },
  { file: 'admin-attachment/+server', methods: ['POST'] },
  { file: 'customers/[id]/detail/+server', methods: ['GET'] },
  { file: 'messages/[id]/bookmark/+server', methods: ['POST', 'DELETE'] },
]

const ROOT = process.cwd()
const srcOf = (file: string) => readFileSync(join(ROOT, 'src/routes/api/chat', `${file}.ts`), 'utf-8')

describe('1b 소스 스캔 — 모든 관리자 전용 채팅 핸들러가 진입부 게이트를 가진다', () => {
  it('13개 파일·16개 핸들러', () => {
    expect(TARGETS.length).toBe(13)
    expect(TARGETS.reduce((n, t) => n + t.methods.length, 0)).toBe(16)
  })

  for (const { file, methods } of TARGETS) {
    it(`${file}: import + ${methods.join('·')} 진입부 첫 문장이 consulting.chat 게이트`, () => {
      const src = srcOf(file)
      expect(src).toContain("import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'")
      for (const m of methods) {
        const decl = src.match(new RegExp(`export const ${m}\\b[^\\n]*=>\\s*\\{\\n`))
        expect(decl, `${file} ${m} 선언 없음`).not.toBeNull()
        const after = src.slice(decl!.index! + decl![0].length)
        // 주석 줄은 건너뛰고 첫 실행문이 게이트여야 한다
        const firstStmt = after.split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('//'))
        expect(firstStmt?.trim(), `${file} ${m} 첫 문장`).toBe("const denied = await requireMenuAccessApi(locals, 'consulting.chat')")
      }
    })
  }
})

describe('1b 동작 — 게이트 거부 시 즉시 403, DB·세션 조회 없음', () => {
  beforeEach(() => {
    guardSpy.mockReset()
    createClientSpy.mockReset()
    guardSpy.mockResolvedValue(new Response(JSON.stringify({ error: '이 기능에 대한 접근 권한이 없습니다.' }), { status: 403 }))
  })

  for (const { file, methods } of TARGETS) {
    for (const m of methods) {
      it(`${file} ${m}: 거부 → 403`, async () => {
        const mod = (await import(/* @vite-ignore */ `../../routes/api/chat/${file}`)) as Record<string, (e: unknown) => Promise<Response>>
        const safeGetSession = vi.fn()
        const locals = { safeGetSession, supabase: { from: vi.fn(), rpc: vi.fn() } }
        const event = {
          locals,
          params: { id: 's1' },
          url: new URL('http://x/api/chat'),
          request: new Request('http://x/api/chat', { method: m === 'GET' ? 'GET' : 'POST', body: m === 'GET' ? undefined : '{}' }),
        }
        const res = await mod[m](event)
        expect(res.status).toBe(403)
        expect(guardSpy).toHaveBeenCalledWith(locals, 'consulting.chat')
        expect(safeGetSession).not.toHaveBeenCalled()
        expect(createClientSpy).not.toHaveBeenCalled()
      })
    }
  }
})

describe('고객용·겸용 채팅 엔드포인트에는 consulting.chat 게이트가 없다', () => {
  it('reservation-card(고객용)·execute-action(겸용)', () => {
    expect(srcOf('sessions/[id]/reservation-card/+server')).not.toContain('requireMenuAccess')
    expect(srcOf('messages/[id]/execute-action/+server')).not.toContain('requireMenuAccess')
  })
})
