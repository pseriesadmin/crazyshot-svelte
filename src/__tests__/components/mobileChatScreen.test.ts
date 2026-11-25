import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')

/** 관리자 모바일 상담채팅 — 플로팅 아이콘 + 모바일 전용 화면 (2026-11-25) */
describe('모바일 현장앱 상담채팅', () => {
  it('두 모바일 화면(/cms/mobile, /cms/mobile/rentals)의 플로팅 그룹에 상담 채팅 아이콘이 있다', () => {
    for (const p of ['src/routes/cms/mobile/+page.svelte', 'src/routes/cms/mobile/rentals/+page.svelte']) {
      expect(read(p)).toContain('<MobileChatFab />')
    }
    expect(read('src/lib/components/cms/MobileChatFab.svelte')).toContain('href="/cms/mobile/chat"')
  })
  it('모바일 상담 화면은 PC와 같은 AdminChatPanel을 mobile 모드로 쓰고 상담 메뉴 권한을 확인한다', () => {
    expect(read('src/routes/cms/mobile/chat/+page.svelte')).toContain('<AdminChatPanel mobile')
    expect(read('src/routes/cms/mobile/chat/+page.server.ts')).toContain("'consulting.chat'")
  })
  it('PC 화면은 mobile 기본값 false라 변하지 않고, 모바일은 목록/대화를 번갈아 보인다', () => {
    const v = read('src/lib/components/chat/AdminChatPanel.svelte')
    expect(v).toContain('mobile = false')
    expect(v).toContain('class:m-hide={mobile && !!selectedSession}')
    expect(v).toContain('class:m-hide={mobile && !selectedSession}')
  })
  it('고객 수신 토스트·스마트폰 /cms/chat 접속이 모바일 상담 화면으로 연결된다', () => {
    expect(read('src/routes/cms/+layout.svelte')).toContain("'/cms/mobile/chat'")
    expect(read('src/routes/cms/chat/+page.server.ts')).toContain('/cms/mobile/chat')
  })
})
