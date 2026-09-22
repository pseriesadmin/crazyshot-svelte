<script lang="ts">
  // 2026-09-21(Stephen 지시) — cart/+page.svelte RentalForm snippet에 인라인으로만 있던
  // 시간선택 UI를 CalendarGrid.svelte와 동일한 패턴(공통 컴포넌트 + 호출측 포지셔닝
  // 래퍼는 그대로 유지)으로 분리. 위치 지정(.time-layer, position:absolute·box-shadow·
  // transition:slide)은 CalendarGrid의 .cal-layer와 동일하게 호출측(cart/+page.svelte)에
  // 남겨두고, 이 컴포넌트는 .cal-root에 대응하는 순수 리스트(.time-list)만 담당한다.
  import { isLockerHour } from '$lib/utils/lockerTimeRange'

  interface Props {
    value?: string
    onselect: (time: string) => void
  }

  let { value, onselect }: Props = $props()

  // 2026-09-10(Stephen 확정) — 30분 단위 선택 버튼 추가를 위해 분(m) 인자 도입.
  function fmtTime(h: number, m: number = 0): string {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  // 시간선택 노출 범위 — 24시간 전체(2026-08-20, Stephen 확정).
  const AM_HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  const PM_HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
</script>

<div class="time-list">
  <div class="time-section">
    <span class="time-section-label">오전</span>
    {#each AM_HOURS as h}
      {@const t00 = fmtTime(h)}
      {@const t30 = fmtTime(h, 30)}
      {@const isSel00 = value === t00}
      {@const isSel30 = value === t30}
      {@const isLocker00 = isLockerHour(t00)}
      {@const isLocker30 = isLockerHour(t30)}
      <div class="time-row-pair">
        <button
          class="time-row"
          class:time-row-locker={isLocker00}
          class:time-row-sel={isSel00 && !isLocker00}
          class:time-row-locker-sel={isSel00 && isLocker00}
          onclick={() => onselect(t00)}
        >{t00}</button>
        <button
          class="time-row"
          class:time-row-locker={isLocker30}
          class:time-row-sel={isSel30 && !isLocker30}
          class:time-row-locker-sel={isSel30 && isLocker30}
          onclick={() => onselect(t30)}
        >{t30}</button>
      </div>
    {/each}
  </div>
  <div class="time-section">
    <span class="time-section-label">오후</span>
    {#each PM_HOURS as h}
      {@const t00 = fmtTime(h)}
      {@const t30 = fmtTime(h, 30)}
      {@const isSel00 = value === t00}
      {@const isSel30 = value === t30}
      {@const isLocker00 = isLockerHour(t00)}
      {@const isLocker30 = isLockerHour(t30)}
      <div class="time-row-pair">
        <button
          class="time-row"
          class:time-row-locker={isLocker00}
          class:time-row-sel={isSel00 && !isLocker00}
          class:time-row-locker-sel={isSel00 && isLocker00}
          onclick={() => onselect(t00)}
        >{t00}</button>
        <button
          class="time-row"
          class:time-row-locker={isLocker30}
          class:time-row-sel={isSel30 && !isLocker30}
          class:time-row-locker-sel={isSel30 && isLocker30}
          onclick={() => onselect(t30)}
        >{t30}</button>
      </div>
    {/each}
  </div>
</div>

<style>
  /* 시간 선택 — 오전/오후 구획 세로 스크롤 리스트(2026-08-17, B안 채택). 세부 경위는
     cart/+page.svelte 이관 전 원본 주석 참고(git blame). */
  .time-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 280px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .time-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .time-section-label {
    display: block;
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--cs-white);
    font: var(--text-m-script-12);
    font-weight: 700;
    color: var(--cs-text-light);
    padding: 6px 4px;
  }
  /* 2026-09-21(Stephen 지시) — 날짜(CalendarGrid.cal-day)에 적용한 것과 동일하게 시간
     숫자에도 --font-en-display(Tilt Warp) 적용. PC(--text-pc-body-14)·Mobile
     (--text-m-script-14B) 모두 원래 14px/700(weight는 아래서 600으로 재정의)로 동일한
     값이라(반응형 비율 원래 1:1) shorthand 뒤에 font-family만 override — 크기·비율은
     전혀 건드리지 않음. */
  .time-row {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 44px;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: 10px;
    font: var(--text-pc-body-14);
    font-family: var(--font-en-display);
    font-weight: 600;
    color: var(--cs-text-dark);
    cursor: pointer;
    transition: background 0.15s;
  }
  /* 2026-09-10(Stephen 확정) — 정시(00분)·30분 버튼을 한 행에 나란히 배치하는 래퍼. */
  .time-row-pair {
    display: flex;
    gap: 10px;
  }
  .time-row-pair .time-row { flex: 1; }
  .time-row:hover { background: var(--cs-purple-op10); }
  .time-row-sel { background: var(--cs-purple) !important; color: var(--cs-white) !important; font-weight: 700; }
  /* 영업외시간(23:00~08:59) — 무인보관함 인계 대상 시간대 시각적 구분(2026-08-20 확정값) */
  .time-row-locker { background: var(--cs-red-xlight); }
  .time-row-locker:hover { background: var(--cs-chat-in-bg); }
  .time-row-locker-sel {
    background: var(--cs-red-xlight) !important;
    color: var(--cs-red) !important;
    font-weight: 700;
  }

  @media (max-width: 640px) {
    .time-list { max-height: 240px; }
    .time-row { font: var(--text-m-script-14B); font-family: var(--font-en-display); }
  }
</style>
