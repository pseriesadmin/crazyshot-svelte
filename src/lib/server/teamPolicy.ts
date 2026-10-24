// '팀 정책' 콘텐츠(공통 푸터 '소개 > 팀' 모달) — 저장 입력 검증 + 고객 화면용 정화 (서버 전용, 2026-10-24)
// 저장 형식은 문서 편집기의 ContentBlock[] 그대로. 저장은 CMS(manager 이상)만 하지만, 고객 브라우저에 그대로 출력되므로
// 읽을 때 한 번 더 허용 목록으로 정화한다(저장형 XSS 방어 — 크레이지로그와 같은 sanitizeCrazylogBlocks 재사용).
import { sanitizeCrazylogBlocks } from '$lib/server/sanitizeCrazylogHtml'
import { isValidCtaUrl } from '$lib/utils/ctaUrl'
import type { ContentBlock } from '$lib/types/content-editor'

export const TEAM_POLICY_MAX_BLOCKS = 200
// DB(upsert_team_policy_settings)는 jsonb 텍스트 1,000,000바이트까지 받는다. jsonb는 구분 공백이 늘고 한글은 3바이트라 서버는 여유를 두고 먼저 막는다
export const TEAM_POLICY_MAX_BYTES = 900_000
const ALLOWED_TYPES = new Set(['text', 'image', 'youtube', 'html', 'divider', 'link-entry'])
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/
const IMAGE_URL_RE = /^(https?:\/\/\S+|\/(?!\/)\S*)$/i

export type ParsedTeamPolicy = { ok: true; blocks: unknown[] } | { ok: false; error: string }

/** CMS 저장 폼의 blocks(JSON 문자열) 검증 — 배열·종류·개수·크기 */
export function parseTeamPolicyBlocks(raw: unknown): ParsedTeamPolicy {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: '저장할 내용이 없습니다.' }
  if (new TextEncoder().encode(raw).length > TEAM_POLICY_MAX_BYTES) return { ok: false, error: '내용이 너무 깁니다. 이미지 수나 본문을 줄여주세요.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: '내용 형식이 올바르지 않습니다.' }
  }
  if (!Array.isArray(parsed)) return { ok: false, error: '내용 형식이 올바르지 않습니다.' }
  if (parsed.length > TEAM_POLICY_MAX_BLOCKS) return { ok: false, error: `내용 블록은 최대 ${TEAM_POLICY_MAX_BLOCKS}개까지 저장할 수 있습니다.` }
  for (const b of parsed) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: '내용 형식이 올바르지 않습니다.' }
    if (!ALLOWED_TYPES.has((b as { type?: unknown }).type as string)) return { ok: false, error: '지원하지 않는 내용 종류가 포함돼 있습니다.' }
  }
  return { ok: true, blocks: parsed }
}

function isKnownBlock(item: unknown): item is ContentBlock {
  if (!item || typeof item !== 'object') return false
  const type = (item as { type?: unknown }).type
  return typeof type === 'string' && ALLOWED_TYPES.has(type)
}

/** 고객 화면에 내려보낼 블록 — 글 정화 + 안전하지 않은 주소·ID를 가진 요소 제거 */
export function prepareTeamPolicyForView(raw: unknown): ContentBlock[] {
  const sanitized = sanitizeCrazylogBlocks(raw)
  if (!Array.isArray(sanitized)) return []
  const out: ContentBlock[] = []
  for (const item of sanitized) {
    if (!isKnownBlock(item)) continue
    if (item.type === 'image') {
      const images = Array.isArray(item.images) ? item.images : []
      const safe = images.filter((i) => i && typeof i.url === 'string' && IMAGE_URL_RE.test(i.url.trim()))
      if (safe.length === 0) continue
      out.push({ ...item, images: safe })
      continue
    }
    if (item.type === 'youtube' && (typeof item.videoId !== 'string' || !YOUTUBE_ID_RE.test(item.videoId))) continue
    if (item.type === 'link-entry' && (typeof item.url !== 'string' || !isValidCtaUrl(item.url))) continue
    out.push(item)
  }
  return out
}
