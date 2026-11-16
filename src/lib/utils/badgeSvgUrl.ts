// 배지 이미지(SVG·PNG) 주소 검증 — 배지 전용 버킷(badge-icons)에 우리 업로드 API가 저장한 파일 주소만 허용한다. (함수·상수 이름은 옛 SVG 전용 시절 그대로 둔다)
// DB 함수 cms_save_badge_template 의 같은 규칙(정규식)과 함께 바꾼다. 호스트는 우리 프로젝트(Stage·Production) 2곳으로 고정.
const BADGE_SVG_URL_RE = /^https:\/\/(?:ezyvffjvuwmtuhpxdjrw|vnbpmvxruyciuuaermyh)\.supabase\.co\/storage\/v1\/object\/public\/badge-icons\/badges\/[0-9a-f-]{36}\.(?:svg|png)$/

export function isBadgeSvgUrl(url: string): boolean {
  return BADGE_SVG_URL_RE.test(url)
}

/** 배지 이미지(SVG·PNG) 최대 크기(바이트) — 썸네일 위에 겹치는 작은 아이콘이라 매우 가볍게 제한한다.
 *  업로드 화면 사전 검사·서버 API·정화기·버킷(204800)이 같은 값을 쓴다 */
export const MAX_BADGE_SVG_BYTES = 200 * 1024
export const BADGE_SVG_SIZE_MESSAGE = '이미지 크기는 200KB 이하여야 해요'
/** 요소(태그) 최대 개수 — 단순한 아이콘만 받는다 */
export const MAX_BADGE_SVG_TAGS = 500
