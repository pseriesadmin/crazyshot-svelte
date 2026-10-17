// csMemo.ts — 상담 메모(cs_records) 단문 메모 검증 (서버·화면 공용)
// 정책(2026-10-17, Stephen): 상담 메모는 세션당 1건 덮어쓰기가 아니라 "단문 메모를 무한 등록"하는 목록이다.
// 메모 1건은 공백을 뺀 100자 이내(한글·영문·숫자·특수문자 모두 1자로 센다). 줄바꿈은 허용하지 않고 공백 하나로 합친다.
export const CS_MEMO_MAX = 100

/** 입력 정리: 앞뒤 공백 제거 + 줄바꿈·연속 공백을 한 칸으로 */
export function normalizeCsMemo(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
}

export type CsMemoCheck = { ok: true; text: string } | { ok: false; error: string }

export function checkCsMemo(raw: unknown): CsMemoCheck {
  const text = normalizeCsMemo(raw)
  if (!text) return { ok: false, error: '메모 내용을 입력해주세요.' }
  // 이모지 등 서로게이트 쌍도 1자로 센다
  if ([...text].length > CS_MEMO_MAX) return { ok: false, error: `메모는 ${CS_MEMO_MAX}자 이내로 입력해주세요.` }
  return { ok: true, text }
}
