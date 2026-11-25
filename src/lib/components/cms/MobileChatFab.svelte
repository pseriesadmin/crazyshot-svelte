<script lang="ts">
  // MobileChatFab — 모바일 현장앱(/cms/mobile*) 플로팅 메뉴의 '상담 채팅' 아이콘 (2026-11-25)
  // 대여목록·카메라 FAB과 같은 75px 원형 SVG. 누르면 모바일 전용 상담 화면(/cms/mobile/chat)으로 이동한다.
  // 응대가 필요한 대화 수는 /cms 레이아웃이 만든 상담 수신함(createCmsChatInbox)의 값을 그대로 쓴다(별도 조회 없음).
  import { getContext } from 'svelte'
  import FabCountBadge from '$lib/components/cms/FabCountBadge.svelte'

  interface InboxCount { readonly count: number }
  const inbox = getContext<InboxCount | undefined>('cmsChatInbox')
  const count = $derived(inbox?.count ?? 0)
</script>

<!-- 일반 링크(a href) — 스크립트 이동(goto)이 막히거나 늦어도 브라우저 기본 이동으로 반드시 착지한다 -->
<a
  href="/cms/mobile/chat"
  class="chat-fab"
  aria-label={count > 0 ? `상담 채팅 — 응대 필요 ${count}건` : '상담 채팅'}
  title="상담 채팅"
>
  <svg xmlns="http://www.w3.org/2000/svg" width="75" height="75" viewBox="0 0 70 70" fill="none" aria-hidden="true">
    <path d="M70 35C70 54.33 54.33 70 35 70C15.67 70 0 54.33 0 35C0 15.67 15.67 0 35 0C54.33 0 70 15.67 70 35Z" fill="#3B2F8A"/>
    <path d="M13.9998 38.532C13.9998 45.7036 23.1602 54.2198 29.7378 54.2198C33.566 54.2198 25.1998 50.7339 29.3125 49.2893C31.7471 48.4342 37.8196 45.7036 37.8196 38.532C37.8196 31.3604 32.29 26.43 25.9097 26.43C19.5294 26.43 13.9998 31.3604 13.9998 38.532Z" fill="#C494FE"/>
    <path d="M56.6772 31.0672C56.6772 39.7986 44.9667 50.1671 36.558 50.1671C31.6641 50.1671 42.3592 45.9231 37.1017 44.1643C33.9894 43.1231 26.2265 39.7986 26.2265 31.0672C26.2265 22.3358 33.2954 16.333 41.4518 16.333C49.6083 16.333 56.6772 22.3358 56.6772 31.0672Z" fill="white"/>
  </svg>
  <FabCountBadge {count} />
</a>

<style>
  .chat-fab {
    position: relative;
    width: 52.5px; /* 75px × 0.7 */
    height: 52.5px;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: none;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
  }
  .chat-fab svg { width: 100%; height: 100%; }
  .chat-fab:active { transform: scale(0.96); }
  @media (hover: hover) {
    .chat-fab:hover { transform: scale(1.06); }
  }
</style>
