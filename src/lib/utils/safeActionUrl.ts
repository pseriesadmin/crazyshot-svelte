// 상담 액션 카드 버튼 주소 검사 (2026-10-24, sp5 SEC-001)
// 허용: 자사 내부 경로("/"로 시작) 또는 http·https 절대 주소(관리자가 직접 입력하는 외부 링크).
// 거절: javascript:·data:·vbscript:·file: 등 실행/로컬 주소, 프로토콜 상대 주소("//"), 백슬래시, 공백·제어문자 포함 주소.
// 카드 payload 는 고객/관리자/자동응답이 만든 값이라 화면에서 열기 직전에 항상 이 함수를 거친다.
import { safeReturnPath } from './safeReturnPath'

export function safeActionUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.trim() === '' || raw !== raw.trim()) return null
  // eslint-disable-next-line no-control-regex -- 제어문자 차단이 목적이다(safeReturnPath.ts 와 같은 패턴)
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return null
  if (raw.startsWith('/')) return safeReturnPath(raw)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null
  return raw
}
