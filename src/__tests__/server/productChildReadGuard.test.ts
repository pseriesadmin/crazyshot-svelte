/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로) */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHILD_OWN_FIELDS,
  PARENT_CONTENT_FIELDS,
  PARENT_DISPLAY_FIELDS,
  PARENT_POLICY_FIELDS,
} from '$lib/server/products/resolveParentProductFields'

/**
 * 재발 방지 가드 — 자식 재고 값을 "직접" 읽는 서버 코드 금지 (자식 재고 부모 참조 전환 Phase 4, 2026-10-07)
 *
 * 정책(products.md §2-16): 자식 재고(parent_product_id 있음)의 이름·분류·브랜드·이미지·슬러그·캡션·설명은 부모 값을 따른다.
 * 예약 행에 붙어 오는 상품 정보(`products!rental_reservations_product_id_fkey(...)`)나 예약의 product_id로 products를 직접
 * 읽어 이런 표시값을 쓰는 서버 코드는 반드시 부모 우선 해석(resolveParentProductFields.ts 헬퍼)을 거쳐야 한다.
 *
 * 검사 규칙(src/routes · src/lib/server 의 .ts 소스 스캔):
 *   R1. 예약-상품 임베드가 표시값을 select하면: 그 select에 parent_product_id가 있고, 파일이 헬퍼를 호출해야 한다.
 *   R2. 예약(rental_reservations)을 다루는 파일이 products를 직접 select해 표시값을 읽으면: 같은 파일의 products select 중
 *       parent_product_id를 읽는 것이 있거나 헬퍼를 호출해야 한다(부모를 따라가는 코드가 있어야 한다).
 *   R3. 헬퍼의 필드 묶음이 자식 고유값(품번·QR·활성 여부 등)을 침범하지 않는다.
 * 예외는 ALLOWED_FILES에 "이유"와 함께 등록한다 — 예외가 더는 필요 없어지면 이 테스트가 삭제를 요구한다.
 */
const ROOT = process.cwd()
const SCAN_DIRS = ['src/routes', 'src/lib/server']

const DISPLAY = /\b(name|category|brand|image_urls|slug|product_caption|description)\b/
const HELPER = /applyParentFields(InPlace|ToRowProducts)|resolveParentProductFields/
const EMBED = /products!rental_reservations_product_id_fkey\s*\(([^)]*)\)/g
const DIRECT = /from\('products'\)\s*\.select\(\s*(['`"])([^'`"]*)\1/g

/** 규칙에서 의도적으로 빠지는 파일 — 이유를 반드시 적는다 */
// (비어 있음 — 2026-10-08 loadSelectedProductDetail.ts의 재고 목록 이름도 헬퍼로 해석해 마지막 예외가 사라졌다)
const ALLOWED_FILES: Record<string, string> = {}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 한 파일 소스의 위반 목록(없으면 빈 배열) */
export function scanProductChildReads(rawSrc: string): string[] {
  const src = stripComments(rawSrc)
  const violations: string[] = []
  const hasHelper = HELPER.test(src)

  for (const m of src.matchAll(EMBED)) {
    const list = m[1].replace(/\s+/g, ' ').trim()
    if (!DISPLAY.test(list)) continue
    if (!/\bparent_product_id\b/.test(list)) violations.push(`R1: 예약-상품 임베드에 parent_product_id 없음 → (${list})`)
    if (!hasHelper) violations.push(`R1: 예약-상품 임베드가 표시값을 읽지만 부모 우선 헬퍼 호출이 없음 → (${list})`)
  }

  if (/rental_reservations/.test(src)) {
    const directs = [...src.matchAll(DIRECT)].map((m) => m[2].replace(/\s+/g, ' ').trim())
    const displayReads = directs.filter((d) => DISPLAY.test(d))
    if (displayReads.length > 0 && !hasHelper && !directs.some((d) => /\bparent_product_id\b/.test(d))) {
      violations.push(`R2: 예약 파일이 products 표시값을 직접 읽지만 부모를 따라가지 않음 → (${displayReads[0]})`)
    }
  }
  return violations
}


/** 신규 재고(자식) INSERT가 복사하면 안 되는 칼럼 — products.md §2-16 */
const COPY_FORBIDDEN_COLUMNS = [
  'brand', 'description', 'product_caption', 'image_urls', 'specifications', 'components',
  'content_blocks', 'keywords', 'sale_price', 'sale_only', 'option_only',
]

/** `.insert({ ... })` 객체 리터럴을 중괄호 균형으로 잘라 낸다 */
function extractInsertObjects(src: string): string[] {
  const out: string[] = []
  const re = /\.insert\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < src.length && depth > 0) {
      const ch = src[i++]
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    out.push(src.slice(start, i - 1))
  }
  return out
}

/** R4: 부모를 지정(parent_product_id: <null 아님>)하는 products INSERT에 복사 금지 칼럼이 있으면 위반 */
export function scanChildInsertCopies(rawSrc: string): string[] {
  const src = stripComments(rawSrc)
  const violations: string[] = []
  for (const body of extractInsertObjects(src)) {
    if (!/\bparent_product_id\s*:\s*(?!null\b|undefined\b)\S/.test(body)) continue
    for (const col of COPY_FORBIDDEN_COLUMNS) {
      if (new RegExp(`(^|[\\s,{])${col}\\s*[:,}]`, 'm').test(body)) violations.push(`R4: 자식 INSERT가 부모 값을 복사함 → ${col}`)
    }
  }
  return violations
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(rel, out)
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(rel)
  }
  return out
}

describe('스캐너 자체 검증(가드가 비어 있지 않다는 보증)', () => {
  it('SG-1 부모 없이 표시값을 읽는 임베드는 위반으로 잡는다', () => {
    const bad = `await db.from('rental_reservations').select('id, products!rental_reservations_product_id_fkey(name, category)')`
    const v = scanProductChildReads(bad)
    expect(v.some((x) => x.startsWith('R1'))).toBe(true)
  })

  it('SG-2 parent_product_id는 있어도 헬퍼 호출이 없으면 위반', () => {
    const bad = `.select('id, products!rental_reservations_product_id_fkey(name, parent_product_id)')`
    expect(scanProductChildReads(bad).some((x) => x.includes('헬퍼 호출이 없음'))).toBe(true)
  })

  it('SG-3 헬퍼를 쓰고 parent_product_id를 읽는 임베드는 통과', () => {
    const ok = `import { applyParentFieldsToRowProducts } from 'x'
      .select('id, products!rental_reservations_product_id_fkey(name, category, parent_product_id)')
      await applyParentFieldsToRowProducts(rows, ['name'])`
    expect(scanProductChildReads(ok)).toEqual([])
  })

  it('SG-4 예약 파일이 products 표시값을 직접 읽고 부모를 따라가지 않으면 위반', () => {
    const bad = `const r = await db.from('rental_reservations').select('id')
      const { data } = await admin.from('products').select('name, image_urls').eq('id', r.product_id)`
    expect(scanProductChildReads(bad).some((x) => x.startsWith('R2'))).toBe(true)
  })

  it('SG-5 직접 읽기라도 parent_product_id를 함께 읽어 부모를 따라가면 통과', () => {
    const ok = `const r = await db.from('rental_reservations').select('id')
      const { data } = await admin.from('products').select('name, parent_product_id').eq('id', r.product_id)`
    expect(scanProductChildReads(ok)).toEqual([])
  })

  it('SG-7 자식 INSERT가 부모 값(brand 등)을 복사하면 R4 위반', () => {
    const bad = `await admin.from('products').insert({ id: newId, name: source.name, brand: source.brand, sale_only: source.sale_only, parent_product_id: rootProductId })`
    const v = scanChildInsertCopies(bad)
    expect(v.some((x) => x.includes('brand'))).toBe(true)
    expect(v.some((x) => x.includes('sale_only'))).toBe(true)
  })

  it('SG-8 이름·분류·슬러그·활성·부모연결·QR만 넣는 자식 INSERT는 통과, 부모(parent_product_id null/없음) INSERT는 복사 칼럼이 있어도 검사 제외', () => {
    const ok = `await admin.from('products').insert({ id: newId, qr_payload: q, category: c, name: n, slug, is_active: true, parent_product_id: rootProductId })`
    expect(scanChildInsertCopies(ok)).toEqual([])
    const parentInsert = `await admin.from('products').insert({ name, brand, image_urls, sale_only, parent_product_id: null })`
    expect(scanChildInsertCopies(parentInsert)).toEqual([])
    const noParentKey = `await admin.from('products').insert({ name, brand, image_urls })`
    expect(scanChildInsertCopies(noParentKey)).toEqual([])
  })

  it('SG-6 주석 속 예시 문자열은 무시한다', () => {
    const ok = `// products!rental_reservations_product_id_fkey(name, category) 형태는 금지\n/* from('products').select('name') */\nconst x = 1`
    expect(scanProductChildReads(ok)).toEqual([])
  })
})

describe('R1·R2 — 서버 소스 전수 스캔', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(d))

  it('RG-1 표시값을 읽는 자식 상품 조회는 전부 부모 우선 해석을 거친다(예외는 이유와 함께 등록된 파일뿐)', () => {
    const offenders: string[] = []
    for (const f of files) {
      if (f in ALLOWED_FILES) continue
      const v = scanProductChildReads(readFileSync(join(ROOT, f), 'utf-8'))
      if (v.length > 0) offenders.push(`${f}\n    ${v.join('\n    ')}`)
    }
    expect(offenders, `자식 재고 값을 직접 읽는 코드가 발견됐다 — resolveParentProductFields.ts 헬퍼를 쓰거나, 정당한 예외면 ALLOWED_FILES에 이유와 함께 등록하라:\n${offenders.join('\n')}`).toEqual([])
  })

  it('RG-2 예외 목록에 오래된 항목이 없다(파일이 존재하고, 예외가 아니면 위반이 나오는 파일만 남긴다)', () => {
    for (const f of Object.keys(ALLOWED_FILES)) {
      const src = readFileSync(join(ROOT, f), 'utf-8')
      expect(scanProductChildReads(src).length, `${f}는 이제 예외가 필요 없다 — ALLOWED_FILES에서 삭제하라`).toBeGreaterThan(0)
    }
  })

  it('RG-6 신규 재고(자식) INSERT에 부모 값 복사 칼럼이 없다(R4)', () => {
    const offenders: string[] = []
    for (const f of files) {
      const v = scanChildInsertCopies(readFileSync(join(ROOT, f), 'utf-8'))
      if (v.length > 0) offenders.push(`${f}\n    ${v.join('\n    ')}`)
    }
    expect(offenders, `자식 재고 INSERT가 부모 값을 복사하고 있다 — 이름·분류만 넣고 나머지는 복사하지 말 것(products.md §2-16):\n${offenders.join('\n')}`).toEqual([])
  })

  it('RG-3 스캔이 실제 파일을 읽고 있다(대상 파일 수·헬퍼 사용 파일 수 하한)', () => {
    expect(files.length).toBeGreaterThan(100)
    const helperUsers = files.filter((f) => HELPER.test(readFileSync(join(ROOT, f), 'utf-8')))
    expect(helperUsers.length).toBeGreaterThanOrEqual(15)
  })
})

describe('R3 — 헬퍼 필드 묶음 불변', () => {
  it('RG-4 자식 고유값 목록에 품번·QR·활성·삭제·부모 연결이 포함된다', () => {
    for (const f of ['id', 'parent_product_id', 'product_code', 'qr_payload', 'is_active', 'deleted_at', 'code_series', 'auto_deactivated_reservation_id']) {
      expect(CHILD_OWN_FIELDS).toContain(f)
    }
  })

  it('RG-5 부모 참조 필드 묶음(표시·정책·콘텐츠)이 자식 고유값을 침범하지 않는다', () => {
    const own = new Set(CHILD_OWN_FIELDS)
    for (const f of [...PARENT_DISPLAY_FIELDS, ...PARENT_POLICY_FIELDS, ...PARENT_CONTENT_FIELDS]) {
      expect(own.has(f), `${f}는 자식 고유값인데 부모 참조 묶음에 들어 있다`).toBe(false)
    }
  })
})
