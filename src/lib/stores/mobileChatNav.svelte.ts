// 모바일 상담 화면(/cms/mobile/chat) ↔ 모바일 레이아웃(서브 GNB) 연결 상태 (2026-11-25)
// 대화창이 열려 있으면 inSession=true, 서브 GNB 좌측 '목록' 버튼이 back()으로 세션 목록으로 돌아간다.
export const mobileChatNav = $state<{ inSession: boolean; back: (() => void) | null }>({ inSession: false, back: null })
