import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { trimEmptyBlocks, nextTeamEditorSync } from '$lib/utils/teamPolicyBlocks'
import type { ContentBlock } from '$lib/types/content-editor'

describe('trimEmptyBlocks — 저장 전 빈 문단 정리', () => {
  it('내용이 전혀 없으면 빈 배열(내용 비우기)', () => {
    expect(trimEmptyBlocks([{ type: 'text', html: '' }])).toEqual([])
    expect(trimEmptyBlocks([{ type: 'text', html: '<p></p>' }, { type: 'text', html: '<p><br></p>' }])).toEqual([])
    expect(trimEmptyBlocks([])).toEqual([])
  })
  it('앞뒤의 빈 문단만 지우고 가운데 구조는 유지한다', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', html: '<p></p>' },
      { type: 'text', html: '<p>팀 소개</p>' },
      { type: 'text', html: '<p></p>' },
      { type: 'divider' },
      { type: 'text', html: '<p>정책</p>' },
      { type: 'text', html: '' },
    ]
    expect(trimEmptyBlocks(blocks)).toEqual([blocks[1], blocks[2], blocks[3], blocks[4]])
  })
  it('이미지·영상·구분선·링크만 있어도 내용이 있는 것으로 본다', () => {
    const img: ContentBlock = { type: 'image', layout: 'individual', images: [{ url: 'https://x/a.png', alt: '' }] }
    expect(trimEmptyBlocks([img])).toEqual([img])
    expect(trimEmptyBlocks([{ type: 'divider' }])).toEqual([{ type: 'divider' }])
  })
})

describe('/cms/set/policy 화면 구성 소스 점검 — 팀 정책 영역', () => {
  const src = readFileSync('src/routes/cms/set/policy/+page.svelte', 'utf-8')
  it("'팀 정책' 영역이 '서비스 기본 정보' 영역 바로 위에 있다", () => {
    const team = src.indexOf('<h2 class="section-title">팀 정책</h2>')
    const info = src.indexOf('<h2 class="section-title">서비스 기본 정보</h2>')
    const sub = src.indexOf('<h2 class="section-title">정기구독 이용안내</h2>')
    expect(team).toBeGreaterThan(sub)
    expect(team).toBeGreaterThan(-1)
    expect(info).toBeGreaterThan(team)
  })
  it('문서 편집기(RichContentEditor, cms)·저장 전 flush·저장 액션·업로드 경로를 쓴다', () => {
    expect(src).toContain("import RichContentEditor from '$lib/components/editor/RichContentEditor.svelte'")
    expect(src).toMatch(/<RichContentEditor[\s\S]*?variant="cms"[\s\S]*?showKeywords=\{false\}/)
    expect(src).toContain('teamEditorRef?.flush()')
    expect(src).toContain('?/saveTeamPolicy')
    expect(src).toContain('uploadPrefix="team-policy/content"')
  })
  it('같은 화면의 다른 저장으로 서버 값이 다시 와도 쓰던 내용을 지우지 않도록 nextTeamEditorSync로 판단한다', () => {
    expect(src).toContain('nextTeamEditorSync(')
    expect(src).not.toMatch(/\$effect\(\(\) => \{\s*const src = data\.teamBlocks as ContentBlock\[\]\s*untrack\(\(\) => \{\s*localTeamBlocks/)
  })
  it('prop으로 $state를 초기화하지 않는다(편집기는 {#key}로 다시 만든다)', () => {
    expect(src).not.toMatch(/\$state\([^)]*data\.teamBlocks/)
    expect(src).toContain('{#key teamEditorKey}')
  })
})

describe('nextTeamEditorSync — 서버 값이 다시 왔을 때 편집기를 지울지 판단', () => {
  it('서버 값이 그대로면(다른 섹션 저장 등으로 재조회) 편집기를 건드리지 않는다', () => {
    expect(nextTeamEditorSync('[1]', '[1]', false)).toEqual({ action: 'keep', applied: '[1]' })
    expect(nextTeamEditorSync('[1]', '[1]', true)).toEqual({ action: 'keep', applied: '[1]' })
  })
  it('쓰던 내용(미저장)이 있으면 서버 값이 달라져도 편집기를 지우지 않는다', () => {
    expect(nextTeamEditorSync('[1]', '[2]', true)).toEqual({ action: 'keep', applied: '[2]' })
  })
  it('쓰던 내용이 없고 서버 값이 달라졌을 때만 새 값으로 편집기를 다시 만든다', () => {
    expect(nextTeamEditorSync('[1]', '[2]', false)).toEqual({ action: 'reset', applied: '[2]' })
    expect(nextTeamEditorSync('', '[]', false)).toEqual({ action: 'reset', applied: '[]' })
  })
})
