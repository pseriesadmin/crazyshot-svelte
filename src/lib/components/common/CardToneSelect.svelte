<script lang="ts">
  // 슬라이드 카드 바탕색 선택 — 정사각 라운드 3종(흰색·옅은 퍼플·다크), 선택된 쪽에 ✓.
  // 관리자 설정 모달의 상품 행(취향직격 테마그룹·홈 카테고리 상품 슬라이드·/products 헤더 슬라이드)이 같은 UI를 쓴다.
  // value 가 비어 있으면 그 카드의 기본 바탕색(defaultTone)이 선택된 것으로 보인다.
  import type { CardTone } from '$lib/utils/cardTone'

  interface Props {
    value: CardTone | null | undefined
    /** value 가 비었을 때 선택된 것으로 표시할 기본 바탕색(카드 종류마다 다름) */
    defaultTone: CardTone
    onselect: (tone: CardTone) => void
  }
  let { value, defaultTone, onselect }: Props = $props()

  const current = $derived<CardTone>(value ?? defaultTone)
</script>

<div class="tone-tray">
  <button type="button" class="tone tone-white" aria-label="슬라이드 카드 바탕 흰색" aria-pressed={current === 'white'} onclick={() => onselect('white')}>{#if current === 'white'}✓{/if}</button>
  <button type="button" class="tone tone-lilac" aria-label="슬라이드 카드 바탕 옅은 퍼플" aria-pressed={current === 'lilac'} onclick={() => onselect('lilac')}>{#if current === 'lilac'}✓{/if}</button>
  <button type="button" class="tone tone-dark" aria-label="슬라이드 카드 바탕 다크" aria-pressed={current === 'dark'} onclick={() => onselect('dark')}>{#if current === 'dark'}✓{/if}</button>
</div>

<style>
  .tone-tray {
    align-self: flex-start;
    display: flex;
    gap: 4px;
    padding: 4px;
    margin-top: 4px;
  }
  .tone {
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm, 8px);
    font-size: 12px;
    font-weight: 700;
    line-height: 24px;
    text-align: center;
    cursor: pointer;
  }
  .tone-white { background: var(--cs-white); color: var(--cs-dark); box-shadow: inset 0 0 0 1px var(--cs-border); }   /* 흰 행 위에서 보이도록 그레이 인라인(--cs-border) */
  .tone-lilac { background: var(--cs-purple-op10); color: var(--cs-dark); }
  .tone-dark  { background: var(--cs-dark);  color: var(--cs-white); }
</style>
