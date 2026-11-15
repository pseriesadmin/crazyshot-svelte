<script lang="ts">
  // 배지 1개 렌더 — CMS 미리보기·고객 상품 카드/상세 공통. 이미지(SVG)는 <img> 로만 표시한다(인라인 삽입 금지).
  import type { BadgeKind } from '$lib/types/badge'

  interface Props {
    kind: BadgeKind
    svg_url?: string | null
    text?: string | null
    bg_color?: string | null
    text_color?: string | null
    /** 기준 크기(px) — 텍스트바는 높이, 이미지형은 정사각 칸 한 변(size×1.5, 비율이 다른 SVG 는 칸 안에 맞춰 표시) */
    size?: number
  }

  let { kind, svg_url = null, text = null, bg_color = null, text_color = null, size = 24 }: Props = $props()

  // 이미지형은 정사각 칸 기준(object-fit: contain) — 한 변 = size × 1.5 (텍스트바 높이와 시각적 무게를 맞춘 값)
  const box = $derived(Math.round(size * 1.5))
  // 텍스트바 높이 = 기준 크기 + 상하 여백 10%
  const barH = $derived(Math.round(size * 1.1))
  // 텍스트바 좌우 여백 = 기준 크기 × 0.6 (알약형 곡선 안쪽에 글자가 여유 있게 앉도록)
  const padX = $derived(Math.round(size * 0.6))
</script>

{#if kind === 'image' && svg_url}
  <img class="badge-img" src={svg_url} alt="" style="width:{box}px;height:{box}px" loading="lazy" />
{:else if kind === 'textbar' && text}
  <span
    class="badge-bar"
    style="background:{bg_color ?? '#3B2F8A'};color:{text_color ?? '#FFFFFF'};height:{barH}px;font-size:{Math.round(size * 0.5)}px;padding:0 {padX}px"
  >{text}</span>
{/if}

<style>
  .badge-img { display: block; object-fit: contain; flex-shrink: 0; }
  .badge-bar {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    border-radius: 9999px; /* 좌우 끝을 최대한 둥글게(알약형) */
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }
</style>
