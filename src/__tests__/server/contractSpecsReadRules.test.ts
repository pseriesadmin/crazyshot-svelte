import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 예약별 계약 특약 사전 등록(Migration #720) 읽기 규칙 — 2026-10-18 sp3 지적 MINOR 1·2 조치 고정
const api = readFileSync('src/routes/api/cms/reservations/[id]/contract-specs/+server.ts', 'utf-8')
const modal = readFileSync('src/lib/components/cms/ContractTemplatePreviewModal.svelte', 'utf-8')
const auto = readFileSync('src/lib/server/contractAutoIssue.ts', 'utf-8')

describe('특약 조회 API — 오류를 빈 목록으로 숨기지 않는다', () => {
  const get = api.slice(api.indexOf('export const GET'), api.indexOf('export const PUT'))
  it('컬럼 없음(오류 코드 42703)일 때만 빈 목록으로 응답한다 — 메시지 문자열 매칭은 쓰지 않는다', () => {
    expect(get).toContain("error.code === '42703'")
    expect(get).not.toMatch(/\.test\(error\.message/)
    expect(get).toContain('return json({ specifications: [] })')
  })
  it('그 밖의 조회 오류는 500으로 응답한다', () => {
    expect(get).toContain('{ status: 500 }')
  })
  it('조회 오류가 나자마자 무조건 빈 목록을 돌려주는 한 줄 분기가 없다', () => {
    expect(get).not.toMatch(/if \(error\) return json\(\{ specifications: \[\] \}\)/)
  })
})

describe('자동발행 특약 선택 — 대표 행(id 최솟값) 우선', () => {
  const start = auto.indexOf('예약별 사전 등록 특약')
  const block = auto.slice(start, start + 1800)
  it('id 오름차순으로 정렬한 뒤 특약이 있는 첫 예약을 고른다', () => {
    expect(block).toContain('.sort((a, b) => a.id - b.id)')
    expect(block).toMatch(/\.find\(r => normalizeContractSpecs\(r\.contract_specifications\)\.length > 0\)/)
  })
  it('취소·만료 예약은 제외하고(활성이 없으면 전체) 고른다', () => {
    expect(block).toContain("select('id, status, contract_specifications')")
    expect(block).toContain("r.status !== 'cancelled' && r.status !== 'expired'")
    expect(block).toContain('active.length > 0 ? active : all')
  })
  it('승인 대상 예약을 먼저 보는 분기가 없다', () => {
    expect(block).not.toContain('r.id === reservationId')
  })
})

describe('수동 발행 모달 — 특약 조회 실패 시 빈 목록으로 진행하지 않는다', () => {
  const i = modal.indexOf('/contract-specs`')
  const block = modal.slice(i - 400, i + 600)
  it('조회 실패(!ok)면 오류를 던져 로딩을 멈춘다', () => {
    expect(block).toContain('if (!specRes.ok) throw new Error(')
  })
  it('조회 실패를 삼키고 reservationSpecs를 빈 목록으로 두는 catch가 없다', () => {
    expect(block).not.toMatch(/catch \{ reservationSpecs = \[\] \}/)
  })
})
