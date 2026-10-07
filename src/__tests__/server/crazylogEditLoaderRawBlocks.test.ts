import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildSandboxedPreviewDoc } from '$lib/utils/previewSanitize'

/**
 * 수정 화면 원본 보존(2026-10-06): 수정 모드 로더가 정화본이 아니라 원본 본문을 에디터로 내려보내야 한다.
 * 정화본을 내려보내면 수정 후 저장 시 이미지·iframe·색상·표 속성 등이 영구히 사라진다.
 * (상세 화면 로더 view/[slug]는 계속 정화한다 — 다른 방문자에게 보이는 경로)
 */
describe('크레이지로그 수정 화면 로더 — 원본 본문 전달', () => {
  const edit = readFileSync('src/routes/crazylog/[slug]/+page.server.ts', 'utf8')
  const view = readFileSync('src/routes/crazylog/view/[slug]/+page.server.ts', 'utf8')

  it('수정 로더는 content_blocks를 정화하지 않는다', () => {
    expect(edit).not.toMatch(/sanitizeCrazylogBlocks\s*\(/)
    expect(edit).toMatch(/existingPost\s*=\s*\{\s*\.\.\.postData\s*\}/)
  })

  it('상세 화면 로더는 여전히 정화한다(방문자 보호)', () => {
    expect(view).toMatch(/sanitizeCrazylogBlocks\s*\(/)
  })
})

describe('buildSandboxedPreviewDoc — 원본 미리보기 문서', () => {
  it('원본을 그대로 담고 CSP로 스크립트·프레임·연결을 막는다', () => {
    const doc = buildSandboxedPreviewDoc('<p onclick="x()">a</p><script>1</script>')
    expect(doc).toContain('<p onclick="x()">a</p><script>1</script>')
    expect(doc).toContain("default-src 'none'")
    expect(doc).not.toMatch(/script-src|frame-src|connect-src/)
    expect(doc).toContain('Content-Security-Policy')
  })
})
