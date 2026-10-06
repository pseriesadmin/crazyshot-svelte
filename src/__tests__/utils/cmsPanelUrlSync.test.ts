/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CMS 무한 로딩 방지(2026-10-06): 패널 열기/닫기는 주소의 ?selected= 만 맞추면 되므로 데이터를 다시 불러오는 goto가 아니라
 * replaceState를 쓴다 — 실시간 새로고침(invalidateAll)과 겹쳐 goto가 취소되면 afterNavigate가 오지 않아 로딩 막이 꺼지지 않았다.
 * 레이아웃의 로딩 막에는 취소 상황을 대비한 자동 해제 안전장치가 있어야 한다.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8')
const fnBody = (src: string, name: string): string => {
  const i = src.indexOf(`function ${name}(`)
  expect(i, name).toBeGreaterThan(-1)
  return src.slice(i, src.indexOf('\n  }\n', i))
}

for (const page of ['src/routes/cms/rentals/+page.svelte', 'src/routes/cms/reservation/+page.svelte']) {
  describe(page, () => {
    const src = read(page)
    it('replaceState를 가져온다', () => {
      expect(src).toMatch(/import \{[^}]*\breplaceState\b[^}]*\} from '\$app\/navigation'/)
    })
    for (const fn of ['selectRow', 'closePanel']) {
      it(`${fn}: goto 없이 syncSelectedUrl(replaceState)로 주소만 맞춘다`, () => {
        const body = fnBody(src, fn)
        expect(body).toContain('syncSelectedUrl(')
        expect(body).not.toContain('goto(')
      })
    }
    it('syncSelectedUrl: replaceState 우선, 라우터 준비 전 예외일 때만 goto로 대체', () => {
      const body = fnBody(src, 'syncSelectedUrl')
      expect(body).toMatch(/try \{\s*replaceState\(/)
      expect(body).toMatch(/catch \{\s*void goto\(/)
    })
    it('필터·페이지 이동은 여전히 goto(데이터 재조회 필요)', () => {
      expect(fnBody(src, 'goPage')).toContain('goto(')
      expect(fnBody(src, 'setStatus')).toContain('goto(')
    })
  })
}

describe('src/routes/cms/+layout.svelte 로딩 막 안전장치', () => {
  const src = read('src/routes/cms/+layout.svelte')
  it('켜진 뒤 일정 시간이 지나면 자동으로 끈다', () => {
    expect(src).toMatch(/NAV_OVERLAY_MAX_MS/)
    expect(src).toMatch(/setTimeout\(\(\) => \{\s*isNavigating = false/)
  })
  it('이동이 완료되면 타이머를 정리한다', () => {
    expect(src).toMatch(/afterNavigate\(\(\) => \{[^}]*clearNavTimer\(\)[^}]*isNavigating = false/s)
  })
})
