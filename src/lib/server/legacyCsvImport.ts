/**
 * 레거시 회원 CSV 파싱 유틸 — /cms/customers/legacy-import 전용
 *
 * ⛔ 원래 이 로직은 legacy-import/+page.server.ts에 직접 정의돼 있었으나, SvelteKit이
 * +page.server.ts에서 load/actions 등 정해진 이름 외의 런타임 export(함수)를 허용하지
 * 않아("Invalid export 'parseCsv'" 500 에러) 그 화면 자체가 한 번도 로드된 적 없는
 * 상태였다(2026-09-11 "미인증 대기 목록" 탭 점검 중 발견). 순수 파싱 로직이라 요청/세션과
 * 무관하므로 $lib/server로 분리했다 — 동작은 100% 동일, 위치만 이동.
 */

/** CSV 한 행을 파싱한 결과 */
export interface CsvRow {
  name: string
  phone: string | null    // 정규화 후 값 (01012345678 형식, 없으면 null)
  email: string | null
  signupAt: string | null // 한국시간 문자열(YYYY-MM-DD 또는 YYYY-MM-DD HH:mm:ss) — 저장 시 kstLocalToIso 로 변환
  purchaseCount: number
  purchaseAmount: number  // 구매금액(KRW) — 없으면 0
  memo: string | null     // 이전 서비스 관리자 메모(여러 줄 가능) — 없으면 null
  birthDate: string | null // YYYY-MM-DD (0000-00-00·잘못된 날짜는 null)
  source: string          // 가입 방식: 'kakao' | 'naver' | 'google' | 'apple' | 'facebook' | 'line' | 'email' | 'csv'
  isStaff: boolean        // 회원 그룹이 "관리그룹"인 운영진 계정
  rawLine: string         // 디버그용 원본 행
}

/** 전화번호로 그룹핑된 결과 */
export interface PhoneGroup {
  phone: string | null    // null = 전화번호 없음 (EC-3)
  rows: CsvRow[]
  representEmail: string | null  // 관리자가 선택하는 대표 이메일 (미선택 = null)
  totalPurchaseCount: number     // 그룹 내 purchaseCount 합산
  totalPurchaseAmount: number    // 그룹 내 purchaseAmount 합산
  memo: string | null            // 그룹 내 메모를 줄바꿈으로 이어 붙인 값
  staff: boolean                 // 그룹의 모든 행이 운영진
  excluded: boolean              // 개별 제외 여부(운영진만 있는 그룹은 기본 true)
}

// ─── 전화번호 정규화 ────────────────────────────────────────────
/**
 * 다양한 포맷을 01012345678 형식으로 정규화
 * - 010-1234-5678, 010.1234.5678, +82-10-1234-5678, 8210... 등 처리
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  // 숫자만 추출
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return null

  // +82 또는 82 접두사 처리 (국가코드 제거)
  let local = digits
  if (local.startsWith('82') && local.length >= 11) {
    local = '0' + local.slice(2)
  }

  // 010xxxxxxxx, 011xxxxxxx, 016xxxxxxx 등 국내 휴대폰 형식 검증
  if (/^01[0-9]\d{7,8}$/.test(local)) {
    return local
  }

  return null
}

// ─── 가입 방식 판정 ─────────────────────────────────────────────
export interface SocialIds {
  kakao?: string
  naver?: string
  google?: string
  apple?: string
  facebook?: string
  line?: string
}

/** 소셜 연동 ID 로 가입 방식을 판정한다. 우선순위: 카카오 > 네이버 > 구글 > 애플 > 페이스북 > 라인, 없으면 이메일 */
export function detectLegacySource(ids: SocialIds): string {
  if (ids.kakao) return 'kakao'
  if (ids.naver) return 'naver'
  if (ids.google) return 'google'
  if (ids.apple) return 'apple'
  if (ids.facebook) return 'facebook'
  if (ids.line) return 'line'
  return 'email'
}

// ─── CSV 표 읽기 (따옴표·따옴표 안 줄바꿈·"" 이스케이프) ──────────────────
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell === '') { inQuotes = true; continue }
    if (ch === delim) { row.push(cell); cell = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    cell += ch
  }
  row.push(cell)
  rows.push(row)
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

type Field = 'name' | 'phone' | 'email' | 'signup' | 'purchaseCount' | 'purchaseAmount' | 'memo' | 'birth' | 'group' | 'source'
  | 'kakao' | 'naver' | 'google' | 'apple' | 'facebook' | 'line'

const HEADER_ALIASES: Record<Field, string[]> = {
  name: ['이름', 'name', '성명'],
  phone: ['연락처', '휴대폰', '전화번호', '전화', 'phone'],
  email: ['이메일', 'email'],
  signup: ['가입일', 'signup'],
  purchaseCount: ['구매횟수(krw)', '구매횟수', 'purchasecount'],
  purchaseAmount: ['구매금액(krw)', '구매금액', 'purchaseamount'],
  memo: ['관리자메모', '메모', 'memo'],
  birth: ['생년월일', 'birth', 'birthdate'],
  group: ['회원그룹'],
  source: ['출처', 'source'],
  kakao: ['kakaoid'],
  naver: ['naverid'],
  google: ['googleid'],
  apple: ['appleid'],
  facebook: ['facebookid'],
  line: ['lineid'],
}

const norm = (h: string): string => h.replace(/\s+/g, '').toLowerCase()

/** 첫 행이 머리글이면 항목 이름 → 열 위치 표를 돌려준다. 이름과 (이메일 또는 연락처) 열이 있어야 머리글로 인정 */
function mapHeader(cells: string[]): Partial<Record<Field, number>> | null {
  const map: Partial<Record<Field, number>> = {}
  const normed = cells.map(norm)
  for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
    const idx = normed.findIndex((c) => HEADER_ALIASES[field].includes(c))
    if (idx >= 0) map[field] = idx
  }
  return map.name !== undefined && (map.email !== undefined || map.phone !== undefined) ? map : null
}

/** 소셜 연동 ID 칸의 값이 실제 ID 인가("0"·"-"·"null" 같은 빈 표시는 연동 아님) */
function realId(v: string | undefined): string | undefined {
  const t = (v ?? '').trim()
  if (!t || ['0', '-', 'null', 'undefined', 'n/a', 'none'].includes(t.toLowerCase())) return undefined
  return t
}

function toInt(raw: string | undefined): number {
  const n = parseInt((raw ?? '').replace(/[,\s]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 생년월일 문자열 검증 — YYYY-MM-DD 이고 실제 존재하는 날짜(1900년 이후)만 돌려준다. 0000-00-00·잘못된 값은 null */
export function parseBirth(raw: string | undefined | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((raw ?? '').trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900) return null
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * CSV 텍스트(탭 또는 콤마 구분) → CsvRow[] 파싱
 * - 머리글이 있으면 항목 이름(이름·연락처·이메일·가입일·구매횟수·구매금액·관리자 메모·생년월일·회원 그룹·소셜 ID)으로 열을 찾는다
 *   → 이전 서비스 원본 내보내기(39열)를 그대로 읽는다. 따옴표 안 줄바꿈(여러 줄 메모)도 한 칸으로 읽는다.
 * - 머리글이 없으면 예전 6열 순서: 이름 / 전화 / 이메일 / 가입일 / 구매횟수 / 원출처
 */
export function parseCsv(rawText: string): CsvRow[] {
  const text = rawText.replace(/^\uFEFF/, '') // 파일 맨 앞의 BOM 무시
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0)
  if (!firstLine) return []
  const delim = firstLine.includes('\t') ? '\t' : ','
  const table = parseDelimited(text, delim)
  if (table.length === 0) return []

  const header = mapHeader(table[0])
  const looksLikeHeader = table[0].some((c) => ['이름', 'name', '성명', 'phone', '휴대폰', 'email', '이메일'].includes(c.trim().toLowerCase()))
  // 머리글처럼 보이는데 필요한 열(이름 + 이메일/연락처)을 못 찾으면 6열 순서로 어긋나게 읽지 않고 읽기를 거부한다(빈 결과 → "유효한 데이터 행이 없습니다" 안내)
  if (looksLikeHeader && !header) return []
  const startIdx = header ? 1 : 0
  const hasSocialCols = !!header && (['kakao', 'naver', 'google', 'apple', 'facebook', 'line'] as Field[]).some((f) => header[f] !== undefined)

  const rows: CsvRow[] = []
  for (let i = startIdx; i < table.length; i++) {
    const cells = table[i].map((c) => c.trim())
    if (cells.length < 2) continue
    const at = (f: Field): string | undefined => (header && header[f] !== undefined ? cells[header[f] as number] : undefined)

    let name: string
    let rawPhone: string
    let email: string | null
    let signupAt: string | null
    let purchaseCount: number
    let purchaseAmount = 0
    let memo: string | null = null
    let birthDate: string | null = null
    let isStaff = false
    let source: string

    if (header) {
      name = at('name') ?? ''
      rawPhone = at('phone') ?? ''
      email = at('email') || null
      signupAt = at('signup') || null
      purchaseCount = toInt(at('purchaseCount'))
      purchaseAmount = toInt(at('purchaseAmount'))
      memo = (at('memo') ?? '').replace(/\r/g, '').trim() || null
      birthDate = parseBirth(at('birth'))
      isStaff = (at('group') ?? '').includes('관리그룹')
      if (hasSocialCols) {
        source = detectLegacySource({
          kakao: realId(at('kakao')), naver: realId(at('naver')), google: realId(at('google')),
          apple: realId(at('apple')), facebook: realId(at('facebook')), line: realId(at('line')),
        })
      } else {
        const s = (at('source') ?? 'csv').toLowerCase()
        source = ['kakao', 'naver'].includes(s) ? s : 'csv'
      }
    } else {
      name = cells[0] || ''
      rawPhone = cells[1] || ''
      email = cells[2] || null
      signupAt = cells[3] || null
      purchaseCount = parseInt(cells[4] || '0', 10) || 0
      const s = (cells[5] || 'csv').toLowerCase()
      source = ['kakao', 'naver'].includes(s) ? s : 'csv'
    }

    if (!name) continue // 이름 없으면 무시

    rows.push({
      name: name.trim(),
      phone: normalizePhone(rawPhone),
      email: email && email.includes('@') ? email.trim() : null,
      signupAt: signupAt || null,
      purchaseCount,
      purchaseAmount,
      memo,
      birthDate,
      source,
      isStaff,
      rawLine: cells.join(delim),
    })
  }

  return rows
}

function sumGroup(rowList: CsvRow[]): Pick<PhoneGroup, 'totalPurchaseCount' | 'totalPurchaseAmount' | 'memo' | 'staff'> {
  const memos = rowList.map((r) => r.memo).filter((m): m is string => !!m)
  return {
    totalPurchaseCount: rowList.reduce((s, r) => s + r.purchaseCount, 0),
    totalPurchaseAmount: rowList.reduce((s, r) => s + r.purchaseAmount, 0),
    memo: memos.length > 0 ? memos.join('\n') : null,
    staff: rowList.length > 0 && rowList.every((r) => r.isStaff),
  }
}

/**
 * CsvRow[] → PhoneGroup[] (전화번호 기준 그룹핑)
 * - 전화번호 있는 행: 동일 전화번호끼리 묶음(구매횟수·구매금액 합산, 메모 이어 붙임)
 * - 전화번호 없는 행: EC-3 처리 — 각각 독립 그룹 (phone: null)
 * - 운영진 행만 있는 그룹은 기본으로 제외(excluded) 표시 — 관리자가 확인 화면에서 바꿀 수 있다
 */
export function groupByPhone(rows: CsvRow[]): PhoneGroup[] {
  const phoneMap = new Map<string, CsvRow[]>()
  const noPhoneRows: CsvRow[] = []

  for (const row of rows) {
    if (row.phone) {
      const existing = phoneMap.get(row.phone) ?? []
      existing.push(row)
      phoneMap.set(row.phone, existing)
    } else {
      noPhoneRows.push(row)
    }
  }

  const groups: PhoneGroup[] = []

  // 전화번호 있는 그룹
  for (const [phone, rowList] of phoneMap.entries()) {
    const sums = sumGroup(rowList)
    // 그룹 크기 1이면 자동 대표 이메일, 2 이상이면 null (관리자 수동 선택 필수)
    const representEmail = rowList.length === 1 ? (rowList[0].email ?? null) : null
    groups.push({ phone, rows: rowList, representEmail, ...sums, excluded: sums.staff })
  }

  // 전화번호 없는 행 — EC-3: 각각 독립 그룹, 기본 미선택(UI에서 경고 표시)
  for (const row of noPhoneRows) {
    const sums = sumGroup([row])
    groups.push({ phone: null, rows: [row], representEmail: row.email ?? null, ...sums, excluded: sums.staff })
  }

  return groups
}
