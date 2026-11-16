<script lang="ts">
  // 배지 1개 렌더 — CMS 미리보기·고객 상품 카드/상세 공통. 이미지(SVG)는 <img> 로만 표시한다(인라인 삽입 금지).
  import type { BadgeKind } from '$lib/types/badge'

  interface Props {
    kind: BadgeKind
    svg_url?: string | null
    text?: string | null
    bg_color?: string | null
    text_color?: string | null
    /** 기준 크기(px) — 텍스트바는 높이, 이미지형은 정사각 칸 한 변(size×1.5, 이미지 파일의 크기·비율과 무관하게 이 정사각 칸을 가득 채워 표시 — 가운데 기준, 비율이 다르면 가장자리가 잘림) */
    size?: number
  }

  let { kind, svg_url = null, text = null, bg_color = null, text_color = null, size = 24 }: Props = $props()

  // 이미지형은 정사각 칸 기준(object-fit: cover, 2026-11-16 Stephen 확정) — 한 변 = size × 1.5 (텍스트바 높이와 시각적 무게를 맞춘 값).
  // SVG·PNG 의 크기·비율이 달라도 칸의 크기·위치가 같고 그림이 칸을 가득 채워 항상 같은 크기로 보인다(정사각이 아니면 가운데 기준으로 가장자리가 잘림).
  const box = $derived(Math.round(size * 1.5))
  // 텍스트바 높이 = 기준 크기 + 상하 여백 10%
  const barH = $derived(Math.round(size * 1.1))
  // 텍스트바 좌우 여백 = 기준 크기 × 0.6 (알약형 곡선 안쪽에 글자가 여유 있게 앉도록)
  const padX = $derived(Math.round(size * 0.6))
  // 텍스트바 글자 크기 — PC(≥768px) = 기준 크기 × 0.5 + 3px(예전보다 두 단계 큼: 카드 11→14·상세 13→16), 모바일 = PC − 2px(카드 12·상세 14). 2026-11-16 Stephen 확정
  const fontPc = $derived(Math.round(size * 0.5) + 3)
  const fontMobile = $derived(fontPc - 2)
</script>

{#if kind === 'image' && svg_url}
  <img class="badge-img" src={svg_url} alt="" style="width:{box}px;height:{box}px" loading="lazy" />
{:else if kind === 'textbar' && text}
  <span
    class="badge-bar"
    style="background:{bg_color ?? '#3B2F8A'};color:{text_color ?? '#FFFFFF'};height:{barH}px;--bar-fs-m:{fontMobile}px;--bar-fs-pc:{fontPc}px;padding:0 {padX}px"
  >{text}</span>
{/if}

<style>
  .badge-img { display: block; object-fit: cover; object-position: center; flex-shrink: 0; }
  .badge-bar {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    border-radius: 9999px; /* 좌우 끝을 최대한 둥글게(알약형) */
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    font-size: var(--bar-fs-m);
  }
  @media (min-width: 768px) {
    .badge-bar { font-size: var(--bar-fs-pc); }
  }
</style>
