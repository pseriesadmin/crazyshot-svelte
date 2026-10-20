<script lang="ts">
  // LinkifiedText — 채팅 글 속 주소를 눌러서 새 탭으로 열 수 있게 보여 준다(말풍선·카드 안내문 공용, 2026-10-20).
  // 글을 그대로 보여 주되 http(s) 주소만 링크로 바꾼다(HTML 주입 없음, 외부 링크는 noopener).
  import { linkifyText } from '$lib/utils/linkify'

  interface Props { text: string | null | undefined }
  let { text }: Props = $props()
  const segments = $derived(linkifyText(text))
</script>

{#each segments as seg, i (i)}{#if seg.kind === 'link'}<a class="chat-link" href={seg.href} target="_blank" rel="noopener noreferrer">{seg.text}</a>{:else}{seg.text}{/if}{/each}

<style>
  .chat-link {
    color: var(--cs-purple);
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
    cursor: pointer;
  }
  .chat-link:hover { color: var(--cs-purple-hover); }
</style>
