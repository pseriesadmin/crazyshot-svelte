// 카카오채널 상담내용 CSV(DATE,USER,MESSAGE) → 빠른답변 일괄등록용 (질문,답변) 쌍 추출
// - CSV는 메시지 내 줄바꿈·쉼표·큰따옴표가 RFC4180 방식(큰따옴표로 감싸고 ""로 이스케이프)으로
//   저장돼 있어 단순 줄단위 split으로는 깨짐 — 그래서 따옴표 상태를 추적하는 전용 파서를 둔다.
// - "고객 질문성 문장 1개 ↔ 관련 상담원 발화 1개" 1:1 매핑(Stephen 확정) — 상담원의
//   실제 발신만 답변으로 인정하고, AI매니저·메뉴 자동응답은 답변 후보에서 제외한다.

export interface KakaoCsvRow {
  date: string
  user: string
  message: string
}

export interface ExtractedQaPair {
  title: string
  content: string
}

const STAFF_SENDER = '주식회사 크레이지샷'

// RFC4180 호환 최소 CSV 파서 — 따옴표 필드 내부의 줄바꿈·쉼표·이스케이프된 큰따옴표("") 처리
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const len = text.length

  while (i < len) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += ch
    i += 1
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export function parseKakaoChatCsv(csvText: string): KakaoCsvRow[] {
  const rows = parseCsvRows(csvText)
  if (rows.length === 0) return []

  const [header, ...body] = rows
  const isHeaderRow = header.length >= 3 && header[0].trim().toUpperCase() === 'DATE'
  const dataRows = isHeaderRow ? body : rows

  return dataRows
    .filter((r) => r.length >= 3)
    .map((r) => ({ date: (r[0] ?? '').trim(), user: (r[1] ?? '').trim(), message: (r[2] ?? '').trim() }))
    .filter((r) => r.message.length > 0)
}

function isRealStaffMessage(user: string): boolean {
  return user === STAFF_SENDER
}

function isCustomerMessage(user: string): boolean {
  return user.length > 0 && !user.startsWith(STAFF_SENDER)
}

function isQuestionLike(message: string): boolean {
  return message.includes('?') || message.includes('？')
}

// 영업시간 외 자동발송 안내문 — 괄호 없는 "주식회사 크레이지샷" 이름으로 발송되지만
// 실제 상담원 답변이 아니라 시스템이 매번 동일하게 내보내는 정형 문구다. 답변 후보에서
// 제외하지 않으면 전혀 무관한 질문에 이 문구가 "답변"으로 잘못 매칭된다.
function isAutoOfficeHoursNotice(message: string): boolean {
  return message === '채팅 운영시간 안내' || message.includes('채팅 가능한 시간이 아닙니다')
}

// 고객의 직전 미답변 질문성 발화 1개와, 그 다음에 나오는 상담원(실제 사람) 발화 1개를 묶는다.
// 상담원 발화가 나오기 전 고객이 질문을 여러 번 남기면 가장 최근(직전) 질문만 채택한다.
export function extractQaPairs(rows: KakaoCsvRow[]): ExtractedQaPair[] {
  const pairs: ExtractedQaPair[] = []
  let pendingQuestion: string | null = null

  for (const row of rows) {
    const { user, message } = row
    if (!message) continue

    if (isCustomerMessage(user)) {
      if (isQuestionLike(message)) {
        pendingQuestion = message
      }
      continue
    }

    if (isRealStaffMessage(user) && pendingQuestion) {
      if (isAutoOfficeHoursNotice(message)) continue
      pairs.push({ title: pendingQuestion, content: message })
      pendingQuestion = null
    }
  }

  return pairs
}

export function extractQaPairsFromCsvText(csvText: string): ExtractedQaPair[] {
  return extractQaPairs(parseKakaoChatCsv(csvText))
}
