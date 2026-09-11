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
  signupAt: string | null // YYYY-MM-DD 또는 ISO 형식
  purchaseCount: number
  source: string          // 'kakao' | 'naver' | 'csv'
  rawLine: string         // 디버그용 원본 행
}

/** 전화번호로 그룹핑된 결과 */
export interface PhoneGroup {
  phone: string | null    // null = 전화번호 없음 (EC-3)
  rows: CsvRow[]
  representEmail: string | null  // 관리자가 선택하는 대표 이메일 (미선택 = null)
  totalPurchaseCount: number     // 그룹 내 purchaseCount 합산
  excluded: boolean              // 개별 제외 여부
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

/**
 * CSV 텍스트(탭 또는 콤마 구분) → CsvRow[] 파싱
 * - 헤더 행 자동 감지 (첫 행이 이름/휴대폰/이메일 등 레이블이면 스킵)
 * - 컬럼 추정: 이름 / 전화 / 이메일 / 가입일 / 구매횟수 / 원출처
 */
export function parseCsv(text: string): CsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) return []

  // 구분자 감지
  const firstLine = lines[0]
  const delimiter = firstLine.includes('\t') ? '\t' : ','

  const rows: CsvRow[] = []
  let startIdx = 0

  // 헤더 행 감지: 첫 행에 숫자가 적거나 이름 키워드가 있으면 헤더로 간주
  const firstCells = firstLine.split(delimiter).map((c) => c.trim().toLowerCase())
  const isHeader =
    firstCells.some((c) => ['이름', 'name', '성명', 'phone', '휴대폰', 'email', '이메일'].includes(c))
  if (isHeader) startIdx = 1

  for (let i = startIdx; i < lines.length; i++) {
    const cells = lines[i].split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ''))
    if (cells.length < 2) continue

    // 컬럼 위치 추정 (유연하게 처리)
    // 가장 많이 들어오는 포맷: 이름, 전화, 이메일, 가입일, 구매횟수, 출처
    const name = cells[0] || ''
    const rawPhone = cells[1] || ''
    const email = cells[2] || null
    const signupAt = cells[3] || null
    const purchaseCount = parseInt(cells[4] || '0', 10) || 0
    const source = (cells[5] || 'csv').toLowerCase()

    if (!name) continue // 이름 없으면 무시

    rows.push({
      name: name.trim(),
      phone: normalizePhone(rawPhone),
      email: email && email.includes('@') ? email.trim() : null,
      signupAt: signupAt || null,
      purchaseCount,
      source: ['kakao', 'naver'].includes(source) ? source : 'csv',
      rawLine: lines[i],
    })
  }

  return rows
}

/**
 * CsvRow[] → PhoneGroup[] (전화번호 기준 그룹핑)
 * - 전화번호 있는 행: 동일 전화번호끼리 묶음
 * - 전화번호 없는 행: EC-3 처리 — 각각 독립 그룹 (phone: null)
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
    const totalPurchaseCount = rowList.reduce((s, r) => s + r.purchaseCount, 0)
    // 그룹 크기 1이면 자동 대표 이메일, 2 이상이면 null (관리자 수동 선택 필수)
    const representEmail =
      rowList.length === 1 ? (rowList[0].email ?? null) : null
    groups.push({
      phone,
      rows: rowList,
      representEmail,
      totalPurchaseCount,
      excluded: false,
    })
  }

  // 전화번호 없는 행 — EC-3: 각각 독립 그룹, 기본 미선택(excluded: false지만 UI에서 경고 표시)
  for (const row of noPhoneRows) {
    groups.push({
      phone: null,
      rows: [row],
      representEmail: row.email ?? null,
      totalPurchaseCount: row.purchaseCount,
      excluded: false,
    })
  }

  return groups
}
