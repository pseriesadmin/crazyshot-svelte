<script lang="ts">
  /**
   * 반납등록 미션 단계 표시 — 손가락 아이콘 + 하나·두울·세엣 (2026-10-22, Stephen 제공 3D 손 아이콘)
   * 1단계 = 엄지척(하나) · 2단계 = 브이(두울) · 3단계 = OK(세엣, 손가락 3개).
   * 이미지는 static/return-steps/finger-{1,2,3}.png 에 둔다. 파일이 없으면 이미지만 숨겨지고 글자(하나·두울·세엣)는 그대로 보인다.
   */
  interface Props {
    step: 1 | 2 | 3
    /** 강조(현재 단계) 여부 — false 면 흐리게 */
    active?: boolean
    /** 아이콘 한 변(px) */
    size?: number
    /** 글자 뒤에 '(1단계)' 같은 단계 표기를 붙일지 */
    showStage?: boolean
    /** 하나·두울·세엣 글자 표시 여부(기본 true — 단계 버튼 옆에서는 아이콘만 보여 준다) */
    showWord?: boolean
  }

  let { step, active = true, size = 44, showStage = false, showWord = true }: Props = $props()

  const WORD: Record<1 | 2 | 3, string> = { 1: '하나', 2: '두울', 3: '세엣' }
  let imgFailed = $state(false)
</script>

<span class="finger" class:dim={!active}>
  {#if !imgFailed}
    <img
      class="finger-img"
      src={`/return-steps/finger-${step}.png`}
      alt=""
      width={size}
      height={size}
      style:width={`${size}px`}
      style:height={`${size}px`}
      onerror={() => (imgFailed = true)}
    />
  {/if}
  {#if showWord}
    <span class="finger-word">{WORD[step]}{showStage ? `(${step}단계)` : ''}</span>
  {/if}
</span>

<style>
  .finger { display: inline-flex; flex-direction: column; align-items: center; gap: 6px; transition: opacity 0.2s, transform 0.2s; }
  .finger.dim { opacity: 0.38; }
  .finger-img { object-fit: contain; display: block; }
  .finger-word { font: var(--text-pc-title-16); line-height: 1; color: var(--cs-text); letter-spacing: -0.3px; white-space: nowrap; }
</style>
