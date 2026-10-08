/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로·상수 패턴, 사용자 입력 없음) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 1단계 1b(2/2) — 상담 하위 메뉴 서버 집행 (2026-10-03)
 *  A. api/cms/chat/* (채팅 화면 전용)            → consulting.chat
 *  B. 빠른답변 쓰기·동의어 API                    → consulting.qna
 *  C. 채팅·빠른답변 화면이 함께 쓰는 공용 API       → consulting.chat 또는 consulting.qna (하나라도 허용이면 통과)
 *  D. /cms/chat/qna 서버 액션 5개                 → consulting.qna (폼 액션은 레이아웃 load보다 먼저 실행되어 직접 게이트 필요)
 */

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))
vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn(), sendPushToAdmins: vi.fn() }))

const createClientSpy = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => createClientSpy(...a) }))

const apiGuard = vi.fn()
const anyGuard = vi.fn()
const actionGuard = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({
  requireMenuAccessApi: (...a: unknown[]) => apiGuard(...a),
  requireAnyMenuAccessApi: (...a: unknown[]) => anyGuard(...a),
  requireMenuAccessAction: (...a: unknown[]) => actionGuard(...a),
}))

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
interface Target { file: string; methods: Method[] }

const CHAT: Target[] = [
  { file: 'src/routes/api/cms/chat/coupon-gift/[messageId]/approve/+server', methods: ['POST'] },
  { file: 'src/routes/api/cms/chat/coupon-gift/direct-send/+server', methods: ['POST'] },
  { file: 'src/routes/api/cms/chat/identity-request/direct-send/+server', methods: ['POST'] },
  { file: 'src/routes/api/cms/chat/pending-inquiries/+server', methods: ['GET'] },
  { file: 'src/routes/api/cms/chat/agent-requests/+server', methods: ['GET'] },
  { file: 'src/routes/api/cms/chat/agent-requests/[id]/resolve/+server', methods: ['POST'] },
  { file: 'src/routes/api/cms/chat/sms-status/[messageId]/+server', methods: ['GET'] },
]
const QNA: Target[] = [
  { file: 'src/routes/api/cms/canned-responses/+server', methods: ['POST'] },
  { file: 'src/routes/api/cms/canned-responses/[id]/+server', methods: ['PATCH', 'DELETE'] },
  { file: 'src/routes/api/cms/canned-responses/bulk-import/+server', methods: ['POST'] },
  { file: 'src/routes/api/cms/synonyms/backfill-cross-lingual/+server', methods: ['POST'] },
  { file: 'src/routes/api/cms/synonyms/scan-reformulations/+server', methods: ['POST'] },
]
const SHARED: Target[] = [
  { file: 'src/routes/api/cms/canned-responses/+server', methods: ['GET'] },
  { file: 'src/routes/api/cms/canned-responses/[id]/use/+server', methods: ['PATCH'] },
  { file: 'src/routes/api/cms/auto-reply-settings/+server', methods: ['GET', 'PATCH'] },
]
const ACTIONS = ['delete', 'promoteCandidate', 'rejectCandidateMember', 'approveReplyCandidate', 'rejectReplyCandidate']
const QNA_PAGE = 'src/routes/cms/chat/qna/+page.server'

const ROOT = process.cwd()
const read = (file: string) => readFileSync(join(ROOT, `${file}.ts`), 'utf-8')

function firstStatementAfter(src: string, re: RegExp): { found: boolean; first: string | undefined } {
  const m = src.match(re)
  if (!m) return { found: false, first: undefined }
  const after = src.slice(m.index! + m[0].length)
  return { found: true, first: after.split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('//'))?.trim() }
}

const handlerRe = (m: Method) => new RegExp(`export const ${m}\\b[^\\n]*=>\\s*\\{\\n`)

describe('소스 스캔 — 진입부 첫 문장이 게이트', () => {
  const sets: [string, Target[], string, string][] = [
    ['A cms/chat/*', CHAT, "const denied = await requireMenuAccessApi(locals, 'consulting.chat')", "import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'"],
    ['B 빠른답변 쓰기·동의어', QNA, "const denied = await requireMenuAccessApi(locals, 'consulting.qna')", "import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'"],
    ['C 공용', SHARED, "const denied = await requireAnyMenuAccessApi(locals, ['consulting.chat', 'consulting.qna'])", "import { requireAnyMenuAccessApi } from '$lib/server/requireMenuAccess'"],
  ]
  for (const [label, targets, stmt, imp] of sets) {
    for (const { file, methods } of targets) {
      it(`${label}: ${file.replace('src/routes/api/', '')} ${methods.join('·')}`, () => {
        const src = read(file)
        expect(src).toContain(imp)
        for (const m of methods) {
          const r = firstStatementAfter(src, handlerRe(m))
          expect(r.found, `${file} ${m} 선언 없음`).toBe(true)
          expect(r.first, `${file} ${m}`).toBe(stmt)
        }
      })
    }
  }

  it('D qna 서버 액션 5개: 진입부 첫 문장이 consulting.qna 액션 게이트', () => {
    const src = read(QNA_PAGE)
    expect(src).toContain("import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'")
    for (const a of ACTIONS) {
      const r = firstStatementAfter(src, new RegExp(`^  ${a}: async \\([^)]*\\) => \\{\\n`, 'm'))
      expect(r.found, `${a} 액션 선언 없음`).toBe(true)
      expect(r.first, a).toBe("const denied = await requireMenuAccessAction(locals, 'consulting.qna')")
    }
  })
})

describe('동작 — 게이트 거부 시 즉시 거부, DB 조회 없음', () => {
  const denied403 = () => new Response(JSON.stringify({ error: 'denied' }), { status: 403 })

  beforeEach(() => {
    apiGuard.mockReset().mockResolvedValue(denied403())
    anyGuard.mockReset().mockResolvedValue(denied403())
    actionGuard.mockReset()
    createClientSpy.mockReset()
  })

  const cases: [string, Target[], 'api' | 'any'][] = [['A', CHAT, 'api'], ['B', QNA, 'api'], ['C', SHARED, 'any']]
  for (const [label, targets, kind] of cases) {
    for (const { file, methods } of targets) {
      for (const m of methods) {
        it(`${label} ${file.replace('src/routes/api/', '')} ${m}: 거부 → 403`, async () => {
          const mod = (await import(/* @vite-ignore */ `../../../${file}`)) as Record<string, (e: unknown) => Promise<Response>>
          const safeGetSession = vi.fn()
          const locals = { safeGetSession, supabase: { from: vi.fn(), rpc: vi.fn() } }
          const event = {
            locals,
            params: { id: 'x', messageId: 'x' },
            url: new URL('http://x/api'),
            request: new Request('http://x/api', { method: m === 'GET' ? 'GET' : 'POST', body: m === 'GET' ? undefined : '{}' }),
          }
          const res = await mod[m](event)
          expect(res.status).toBe(403)
          expect(kind === 'api' ? apiGuard : anyGuard).toHaveBeenCalled()
          expect(safeGetSession).not.toHaveBeenCalled()
          expect(createClientSpy).not.toHaveBeenCalled()
        })
      }
    }
  }

  it('D qna 서버 액션: 거부 시 fail 403이 그대로 반환되고 DB 조회 없음', async () => {
    const { fail } = await import('@sveltejs/kit')
    const mod = (await import('../../routes/cms/chat/qna/+page.server')) as { actions: Record<string, (e: unknown) => Promise<unknown>> }
    for (const a of ACTIONS) {
      actionGuard.mockReset().mockResolvedValue(fail(403, { error: 'denied' }))
      createClientSpy.mockClear()
      const safeGetSession = vi.fn()
      const locals = { safeGetSession, supabase: { from: vi.fn(), rpc: vi.fn() } }
      const request = new Request('http://x', { method: 'POST', body: new FormData() })
      const res = (await mod.actions[a]({ locals, request })) as { status: number }
      expect(res.status, a).toBe(403)
      expect(actionGuard, a).toHaveBeenCalledWith(locals, 'consulting.qna')
      expect(safeGetSession, a).not.toHaveBeenCalled()
      expect(createClientSpy, a).not.toHaveBeenCalled()
    }
  })
})
