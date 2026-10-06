/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 예약코드는 주문 단위로 공유된다(Migration 400·649) — 같은 코드의 행이 여러 개여도 QR 스캔 착지가 오류 없이
 * 가장 먼저 만들어진(id가 가장 작은) 예약으로 가야 한다. maybeSingle()은 2행 이상이면 PGRST116 오류를 낸다.
 */
const src = readFileSync(join(process.cwd(), 'src/routes/cms/mobile/qr/reservation/[code]/+page.server.ts'), 'utf-8')

describe('QR 예약코드 스캔 — 같은 코드 여러 행', () => {
  it('reservation_code 조회가 id 오름차순 1건으로 결정론적이다', () => {
    const q = src.slice(src.indexOf(".ilike('reservation_code'"), src.indexOf('if (rErr)'))
    expect(q).toContain(".order('id', { ascending: true })")
    expect(q).toContain('.limit(1)')
    expect(q).toContain('.maybeSingle()')
  })
})
