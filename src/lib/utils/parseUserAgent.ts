// src/lib/utils/parseUserAgent.ts
// UA 문자열을 "Chrome 128 · macOS" 형태로 가공하는 경량 파서
// 지원 브라우저: Chrome, Edge, Firefox, Safari
// 지원 OS: macOS, Windows, iOS, Android, Linux
// 알 수 없는 UA → 원문 그대로 폴백 (과잉 커버리지 금지)

export interface ParsedUA {
  browser: string  // e.g. "Chrome", "Safari", "unknown"
  browserVersion: string  // e.g. "128"
  os: string  // e.g. "macOS", "iOS", "unknown"
  display: string  // e.g. "Chrome 128 · macOS"
}

/**
 * User-Agent 문자열을 파싱해 브라우저·OS 정보를 반환한다.
 * - Edge는 Chrome보다 먼저 체크 (Edge UA에는 "Chrome/" 도 포함되므로)
 * - Safari는 Chrome/Firefox/Edge 이후에 체크 (Chrome·Edge UA에도 "Safari/" 포함)
 */
export function parseUserAgent(ua: string): ParsedUA {
  if (!ua) return { browser: 'unknown', browserVersion: '', os: 'unknown', display: '알 수 없음' }

  // ── 브라우저 감지 ──────────────────────────────────────────
  let browser = 'unknown'
  let browserVersion = ''

  const edgeMatch = ua.match(/Edg\/(\d+)/)
  const chromeMatch = ua.match(/Chrome\/(\d+)/)
  const firefoxMatch = ua.match(/Firefox\/(\d+)/)
  // Safari: UA에 "Safari"가 있고 Edge/Chrome/Firefox가 아닌 경우
  // "Version/X.Y" 뒤에 Mobile/15E148 등이 끼어있어 단순 순방향 정규식으로 미매칭 — 분리 처리
  const isSafariUA = !edgeMatch && !chromeMatch && !firefoxMatch && /Safari/.test(ua)
  const safariVersionMatch = isSafariUA ? ua.match(/Version\/(\d+)/) : null

  if (edgeMatch) {
    browser = 'Edge'
    browserVersion = edgeMatch[1]
  } else if (chromeMatch) {
    browser = 'Chrome'
    browserVersion = chromeMatch[1]
  } else if (firefoxMatch) {
    browser = 'Firefox'
    browserVersion = firefoxMatch[1]
  } else if (isSafariUA && safariVersionMatch) {
    browser = 'Safari'
    browserVersion = safariVersionMatch[1]
  }

  // ── OS 감지 ───────────────────────────────────────────────
  let os = 'unknown'

  if (/iPhone|iPad|iPod/.test(ua)) {
    os = 'iOS'
  } else if (/Android/.test(ua)) {
    os = 'Android'
  } else if (/Mac OS X/.test(ua)) {
    os = 'macOS'
  } else if (/Windows/.test(ua)) {
    os = 'Windows'
  } else if (/Linux/.test(ua)) {
    os = 'Linux'
  }

  // ── 표시 문자열 조합 ────────────────────────────────────────
  const browserDisplay = browserVersion ? `${browser} ${browserVersion}` : browser
  let display: string

  if (browser === 'unknown' && os === 'unknown') {
    // 둘 다 알 수 없으면 원문 폴백
    display = ua.length > 80 ? ua.slice(0, 80) + '…' : ua
  } else if (browser === 'unknown') {
    display = os
  } else if (os === 'unknown') {
    display = browserDisplay
  } else {
    display = `${browserDisplay} · ${os}`
  }

  return { browser, browserVersion, os, display }
}
