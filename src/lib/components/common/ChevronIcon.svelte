<script lang="ts">
  interface Props {
    size?: number
    color?: string
    direction?: 'right' | 'left' | 'up' | 'down'
  }

  let { size = 8, color = '#aaaaaa', direction = 'right' }: Props = $props()

  const ROTATE: Record<NonNullable<Props['direction']>, number> = {
    right: 0,
    down: 90,
    left: 180,
    up: 270,
  }
</script>

<!-- CMS·USER 공통 chevron 아이콘 — 리스트 화살표·아코디언·페이지 이동 등에서 공용 사용 -->
<svg
  width={size}
  height={size * 1.75}
  viewBox="0 0 8 14"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
  style="transform: rotate({ROTATE[direction]}deg); flex-shrink: 0;"
>
  <path d="M1 1L7 7L1 13" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
</svg>
