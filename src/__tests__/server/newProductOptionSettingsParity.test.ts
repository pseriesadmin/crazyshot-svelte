import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 상품 등록(/cms/products/new) 옵션상품 설정이 상품목록 패널(ProductDetailPanel)과 같은 5개 설정·버튼형 콤보를 갖는지 점검
 * (2026-10-26 — 2026-09-28 Migration #569·#570 에서 '무료 제공'·'수량 본상품 연동'이 패널에만 추가돼 등록 화면에서 빠져 있던 결함)
 */
const NEW_PAGE = readFileSync('src/routes/cms/products/new/+page.svelte', 'utf8')
const PANEL = readFileSync('src/lib/components/cms/ProductDetailPanel.svelte', 'utf8')

const KEYS = ['is_required', 'min_select_required', 'delivery_rental_disabled', 'is_free', 'qty_follows_main'] as const
const LABELS = ['필수 선택', '최소 1개 선택 필수', '배송 대여 불가', '무료 제공', '수량 본상품 연동'] as const

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`)
  expect(start, `${name} 함수가 있어야 한다`).toBeGreaterThan(-1)
  const open = src.indexOf('{', src.indexOf(')', start))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`${name} 본문을 찾지 못했다`)
}

describe('상품 등록 화면 옵션상품 설정 — 패널과 동일한 5개 설정', () => {
  it('SelectedOption 타입이 5개 설정 키를 모두 가진다', () => {
    const iface = NEW_PAGE.slice(NEW_PAGE.indexOf('interface SelectedOption'), NEW_PAGE.indexOf('let optionKeyword'))
    for (const k of KEYS) expect(iface).toContain(`${k}: boolean`)
  })

  it('옵션 추가 시 5개 설정이 모두 꺼짐(false)으로 초기화된다', () => {
    const body = fnBody(NEW_PAGE, 'addOptionProduct')
    for (const k of KEYS) expect(body).toMatch(new RegExp(`${k}:\\s*false`))
  })

  it('일괄 적용(applyBulk)이 5개 설정을 모두 반영한다', () => {
    const body = fnBody(NEW_PAGE, 'applyBulk')
    for (const k of KEYS) expect(body).toContain(`${k}:`)
  })

  it('저장 직렬화(serializeOptionLinks)가 5개 설정을 모두 서버로 보낸다', () => {
    const body = fnBody(NEW_PAGE, 'serializeOptionLinks')
    for (const k of KEYS) expect(body).toContain(`${k}: o.${k}`)
  })

  it('일괄 적용 행과 옵션 카드 모두 5개 설정을 버튼형 콤보(opt-combo-btn)로 보여준다', () => {
    for (const label of LABELS) {
      const count = NEW_PAGE.split(`>${label}</button>`).length - 1
      expect(count, `${label} 버튼은 일괄 1 + 카드 1 = 2곳`).toBe(2)
    }
    expect(NEW_PAGE).toContain('opt-combo-btn--on')
  })

  it('옵션 설정에 체크박스를 쓰지 않는다 (CMS 표준: input checkbox 신규 작성 금지)', () => {
    const section = NEW_PAGE.slice(NEW_PAGE.indexOf('일괄 적용'), NEW_PAGE.indexOf('③-B 결합상품'))
    expect(section).not.toContain('type="checkbox"')
  })

  it('두 화면이 보내는 옵션 설정 키 집합이 같다 (패널 기준)', () => {
    const panelBody = fnBody(PANEL, 'saveOptions')
    const panelKeys = KEYS.filter((k) => panelBody.includes(`${k}: o.${k}`))
    const newKeys = KEYS.filter((k) => fnBody(NEW_PAGE, 'serializeOptionLinks').includes(`${k}: o.${k}`))
    expect(newKeys).toEqual(panelKeys)
    expect(newKeys).toHaveLength(5)
  })
})

describe('상품 등록 화면 — 일괄 적용 콤보를 누르면 옵션 카드 콤보에 즉시 동반 적용', () => {
  // [라벨, 설정 키, 일괄 상태 변수]
  const MAP: Array<[string, string, string]> = [
    ['필수 선택', 'is_required', 'bulkRequired'],
    ['최소 1개 선택 필수', 'min_select_required', 'bulkMinSelectRequired'],
    ['배송 대여 불가', 'delivery_rental_disabled', 'bulkDeliveryDisabled'],
    ['무료 제공', 'is_free', 'bulkFree'],
    ['수량 본상품 연동', 'qty_follows_main', 'bulkQtyFollowsMain'],
  ]
  const bulkRow = NEW_PAGE.slice(NEW_PAGE.indexOf('<div class="bulk-row">'), NEW_PAGE.indexOf('<CmsDragList bind:items={selectedOptions}'))

  it('유틸 applyOptionFlag 를 사용한다', () => {
    expect(NEW_PAGE).toContain("from '$lib/utils/optionLinkFlags'")
  })

  for (const [label, key, bulkVar] of MAP) {
    it(`일괄 '${label}' 버튼이 ${bulkVar} 를 뒤집고 모든 카드의 ${key} 에 같은 값을 적용한다`, () => {
      const re = new RegExp(
        `onclick=\\{\\(\\) => \\{ ${bulkVar} = !${bulkVar}; selectedOptions = applyOptionFlag\\(selectedOptions, '${key}', ${bulkVar}\\) \\}\\}>${label}</button>`,
      )
      expect(bulkRow).toMatch(re)
    })
  }
})
