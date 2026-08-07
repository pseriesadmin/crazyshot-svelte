<script lang="ts">
  interface Props {
    size?: number
    color?: string
  }

  let { size = 16, color = 'currentColor' }: Props = $props()
</script>

<!-- CMS·USER 공통 화살표 아이콘(arrow02) — 랜딩·상세이동 등 심플 화살표 버튼에서 공용 사용 -->
<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke={color}
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <line x1="5" y1="12" x2="19" y2="12" />
  <polyline points="12 5 19 12 12 19" />
</svg>
