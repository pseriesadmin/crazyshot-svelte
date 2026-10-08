// 상품 상세 '상품설명' 탭이 새 편집기(RichContentEditor)로 교체된 배선 점검(소스 스캔) — 구독 설명 탭과 같은 패턴
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const newPage = readFileSync('src/routes/cms/products/new/+page.svelte', 'utf8')
const panel = readFileSync('src/lib/components/cms/ProductDetailPanel.svelte', 'utf8')
const editor = readFileSync('src/lib/components/editor/RichContentEditor.svelte', 'utf8')
const keywords = readFileSync('src/lib/components/editor/KeywordTagInput.svelte', 'utf8')

describe('상품설명 탭 새 편집기 배선', () => {
  it('옛 편집기 대신 RichContentEditor(cms 변형)를 쓴다', () => {
    expect(panel).not.toMatch(/import CmsContentEditor/)
    expect(panel).toMatch(/import RichContentEditor from '\$lib\/components\/editor\/RichContentEditor\.svelte'/)
    expect(panel.match(/<RichContentEditor\s+bind:this[\s\S]*?\/>/)?.[0] ?? '').toMatch(/variant="cms"/)
  })

  it('키워드를 숨기지 않는다(상품설명은 키워드 사용)', () => {
    const tag = panel.match(/<RichContentEditor\s+bind:this[\s\S]*?\/>/)?.[0] ?? ''
    expect(tag).not.toMatch(/showKeywords=\{false\}/)
    expect(tag).toMatch(/bind:keywords=\{localKeywords\}/)
  })

  it('재고 단위(자식) 상품은 읽기 전용', () => {
    const tag = panel.match(/<RichContentEditor\s+bind:this[\s\S]*?\/>/)?.[0] ?? ''
    expect(tag).toMatch(/readonly=\{isChildProduct\}/)
  })

  it('서버값 재동기화는 {#key}로 재마운트하고 키 증가는 untrack으로 감싼다', () => {
    expect(panel).toMatch(/\{#key contentEditorKey\}/)
    expect(panel).toMatch(/untrack\(\(\) => \{ contentEditorKey \+= 1 \}\)/)
  })

  it('재동기화 $effect의 첫 실행은 편집기를 다시 마운트하지 않는다(마운트 직후 이중 생성 방지)', () => {
    expect(panel).toMatch(/if \(contentEditorSynced\) untrack\(\(\) => \{ contentEditorKey \+= 1 \}\)\s*contentEditorSynced = true/)
    expect(panel).toMatch(/let contentEditorSynced = false/)
  })

  it('저장 직전 flush로 대기 중 편집을 반영하고 실패 시 저장을 멈춘다', () => {
    expect(panel).toMatch(/contentEditorRef\?\.flush\(\)/)
    expect(panel).toMatch(/flushed && !flushed\.ok/)
    expect(panel).toMatch(/JSON\.stringify\(blocksToSave\)/)
  })

  it('재고 단위 상품은 저장 버튼이 없고 saveContent도 거부한다', () => {
    expect(panel).toMatch(/if \(isChildProduct\) \{ csToast\.warning\('대표 상품에서 수정하세요\.'\); return \}/)
  })
})

describe('편집기 읽기 전용 모드', () => {
  it('readonly prop이 편집 가능 여부·도구·키워드 입력을 모두 끈다', () => {
    expect(editor).toMatch(/readonly\?: boolean/)
    expect(editor).toMatch(/editable: !readonly/)
    expect(editor).toMatch(/\{#if !isMobile && !readonly\}/)
    expect(editor).toMatch(/\{#if ctxKind && !readonly\}/)
    expect(editor).toMatch(/const showMobileBar = \$derived\(!readonly &&/)
    expect(editor).toMatch(/<KeywordTagInput bind:keywords \{readonly\} \/>/)
    expect(editor).toMatch(/editor\.setEditable\(!ro\)/)
  })

  it('편집기 루트가 내부 폼의 submit 전파를 막는다(바깥 <form> 안에서 쓰일 때 상품 등록 오제출 방지)', () => {
    expect(editor).toMatch(/<div class="rc-root"[^>]*onsubmit=\{\(e\) => e\.stopPropagation\(\)\}/)
  })

  it('키워드 입력은 읽기 전용이면 입력창·삭제 버튼을 숨긴다', () => {
    expect(keywords).toMatch(/readonly\?: boolean/)
    expect(keywords).toMatch(/\{#if !readonly\}<button[^>]*kw-del/)
    expect(keywords).toMatch(/\{#if !readonly && keywords\.length < max\}/)
  })
})

describe('상품 신규등록 화면 새 편집기 배선', () => {
  it('옛 편집기 대신 RichContentEditor(cms 변형)를 쓰고 키워드를 유지한다', () => {
    expect(newPage).not.toMatch(/CmsContentEditor/)
    expect(newPage).toMatch(/import RichContentEditor from '\$lib\/components\/editor\/RichContentEditor\.svelte'/)
    const tag = newPage.match(/<RichContentEditor\s+bind:this[\s\S]*?\/>/)?.[0] ?? ''
    expect(tag).toMatch(/variant="cms"/)
    expect(tag).toMatch(/bind:blocks=\{contentBlocks\}/)
    expect(tag).toMatch(/bind:keywords=\{contentKeywords\}/)
    expect(tag).not.toMatch(/showKeywords=\{false\}/)
    expect(tag).not.toMatch(/readonly/)
  })

  it('제출 직전에 대기 중 편집을 flush해 폼 값에 싣고, 실패 시 제출을 취소한다', () => {
    expect(newPage).toMatch(/use:enhance=\{\(\{ cancel, formData \}\) =>/)
    expect(newPage).toMatch(/contentEditorRef\?\.flush\(\)/)
    expect(newPage).toMatch(/flushed && !flushed\.ok[\s\S]*?cancel\(\)/)
    expect(newPage).toMatch(/formData\.set\('content_blocks', JSON\.stringify\(flushed\.blocks\)\)/)
  })

  it('서버가 읽는 hidden 필드(content_blocks·keywords)는 그대로 유지된다', () => {
    expect(newPage).toMatch(/name="content_blocks"/)
    expect(newPage).toMatch(/name="keywords"/)
  })
})

describe('구독 설명 탭·원본 HTML 다이얼로그 후속 보완', () => {
  const sub = readFileSync('src/lib/components/cms/subscription/SubscriptionDetailPanel.svelte', 'utf8')

  it('구독 설명 탭도 재동기화 첫 실행에서는 재마운트하지 않는다', () => {
    expect(sub).toMatch(/if \(contentEditorSynced\) untrack\(\(\) => \{ contentEditorKey \+= 1 \}\)\s*contentEditorSynced = true/)
    expect(sub).toMatch(/let contentEditorSynced = false/)
  })

  it('원본 HTML 변환 확인 체크박스에서 Enter는 무시한다(바깥 등록 폼의 암묵 제출 방지)', () => {
    expect(editor).toMatch(/<input type="checkbox" bind:checked=\{legacyDlg\.ack\} onkeydown=\{\(e\) => \{ if \(e\.key === 'Enter'\) e\.preventDefault\(\) \}\} \/>/)
  })
})
