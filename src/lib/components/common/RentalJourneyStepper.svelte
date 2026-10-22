<script lang="ts">
  import { tick, type Snippet } from 'svelte'

  interface Props {
    status: string
    steps?: string[]  // 표시할 status 값 목록 — 미지정 시 전체 6단계
    productName?: string  // bg 박스 상단 좌측에 표시할 대여 상품명(선택 — 미지정 시 미노출)
    compact?: boolean                  // 박스 상하 패딩 50% 축소(22→11px) — CMS 취소·환불 사유 박스용, 기본 false
    cancelledLabel?: string            // 취소 상태 문구(기본 '취소됨' — CMS 취소·환불 사유 박스는 '취소사유등록')
    cancelledAlign?: 'center' | 'start'  // 취소됨 표시 위치(기본 center — CMS 취소·환불 사유 박스는 start=좌측)
    returnDay?: 'before' | 'reached'   // 고객 화면 전용(2026-10-22): 대여중일 때만 의미 — before=대여중이 현재·반납중 칸은 비활성(기존 표시), reached=반납 안내 시각 도달(칸 이름이 '반납일'로 바뀌며 현재 단계). 고객이 반납 제출하면 상태가 반납중이 되어 이름만 '반납중'으로 바뀜
    fluid?: boolean                    // slim 과 함께 — 고객 화면용: 컨테이너 폭에 맞춰 원형 배지·간격이 줄어든다(34~46px). 기본 false(CMS 헤더는 고정 48px)
    slim?: boolean                     // 패널 헤더용 슬림형 — 한 줄(점+라벨 가로 배치), 현재 단계 점에 옅은 퍼플 물결 모션 반복(2026-10-22). 기본 false
    children?: Snippet    // bg 박스 안, 단계 표시 아래에 넣을 추가 콘텐츠(선택 — CMS 취소·환불 사유 입력 등, 미지정 시 기존과 동일)
  }

  let { status, steps, productName, children, cancelledAlign = 'center', cancelledLabel, compact = false, slim = false, fluid = false, returnDay }: Props = $props()

  const ALL_STEPS = [
    { status: 'hold',             label: '예약신청' },
    { status: 'contract_sent',    label: '계약발송' }, // 전자계약서 발행·발송 단계 — steps 에 명시해야만 표시(예약현황 패널에서 발송된 건만)
    { status: 'confirmed',        label: '계약완료' },
    { status: 'shipped',          label: '반출중' },
    { status: 'in_use',           label: '대여중' },
    { status: 'return_requested', label: '반납중' },
    { status: 'returned',         label: '반납완료' },
  ]

  let visibleSteps = $derived(
    (steps ? ALL_STEPS.filter(s => steps!.includes(s.status)) : ALL_STEPS.filter(s => s.status !== 'contract_sent'))
      .map(s => (returnDay === 'reached' && status === 'in_use' && s.status === 'return_requested' ? { ...s, label: '반납일' } : s))
      // 장바구니에 담기만 한 임시예약(draft, 아직 예약신청 전)은 첫 단계를 '예약대기'로 표시한다(2026-10-22, Stephen 지시). 예약신청이 등록되면(hold) 기존대로 '예약신청'.
      .map(s => (status === 'draft' && s.status === 'hold' ? { ...s, label: '예약대기' } : s))
  )

  let currentStepIndex = $derived(
    status === 'completed'
      ? visibleSteps.length - 1
      : visibleSteps.findIndex(s => s.status === (returnDay === 'reached' && status === 'in_use' ? 'return_requested' : status === 'draft' ? 'hold' : status))
  )

  // 슬림형 원형 배지 안 텍스트 — 4글자 이상은 반으로 나눠 두 줄(계약/완료), 3글자 이하는 한 줄
  function badgeLines(label: string): string[] {
    if (label.length < 4) return [label]
    const h = Math.ceil(label.length / 2)
    return [label.slice(0, h), label.slice(h)]
  }

  let isCancelled = $derived(status === 'cancelled' || status === 'damage_claimed')

  // 모바일 아코디언 등 늦게 렌더링/확장되는 컨테이너에 들어갈 때 overflow-x 스크롤 위치가
  // 0이 아닌 상태로 초기화되어 좌측이 잘려 보이는 문제 방지 — 항상 맨 왼쪽(신청 단계)부터 보이도록 고정
  let stepperEl = $state<HTMLDivElement | null>(null)
  // 고객 화면 fluid(모바일): 배지를 줄이지 않고 가로로 밀어 보는 띠로 두고, 현재 단계를 가운데로 맞춘다. 넘칠 때만 좌우 끝을 흐리게(fade).
  let fade = $state(false)
  $effect(() => {
    status
    void returnDay // 대여중 → '반납일' 전환·steps 변경으로 현재 단계 위치가 바뀌어도 다시 가운데로 맞춘다(sp3 MINOR-3)
    void steps
    if (!stepperEl) return
    const el = stepperEl
    if (!fluid) { el.scrollLeft = 0; return }
    // 배지 줄의 실제 폭(레이아웃 값 — 진입 모션의 scale·이동 영향 없음)이 박스보다 넓으면 밀어 보는 띠(fade)로 전환하고,
    // 현재 단계 배지를 가운데로 맞춘다. 스크롤로 가려지지 않는 처음·끝 단계는 억지로 가운데에 두지 않는다(여백 없음 — 스크롤 한계에서 멈춤, 2026-10-22 Stephen 지시).
    const sync = async () => {
      const items = el.querySelectorAll<HTMLElement>('.step-item')
      const first = items[0]
      const last = items[items.length - 1]
      const active = el.querySelector<HTMLElement>('.step-item.active')
      if (!first || !last) return
      const need = last.offsetLeft + last.offsetWidth - first.offsetLeft
      const over = need > el.clientWidth - 24 + 1 // 24 = 좌우 기본 여백 12px×2
      fade = over
      await tick()
      if (!over || !active) { el.scrollLeft = 0; return }
      const x = active.offsetLeft - el.offsetLeft
      el.scrollTo({ left: x + active.offsetWidth / 2 - el.clientWidth / 2, behavior: 'instant' })
    }
    sync()
    document.fonts?.ready.then(sync)
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  })
</script>

<div class="journey-stepper" class:compact class:slim class:fluid>
  {#if productName}
    <p class="stepper-product-name">{productName}</p>
  {/if}
  <div class="stepper-scroll" style="--n: {visibleSteps.length}" class:fade class:cancelled-start={isCancelled && cancelledAlign === 'start'} role="list" aria-label="대여 여정" bind:this={stepperEl}>
    {#if isCancelled}
      <div class="journey-cancelled">
        <span class="cancelled-icon">✕</span>
        <span class="cancelled-label">
          {status === 'damage_claimed' ? '파손신고' : (cancelledLabel ?? '취소됨')}
        </span>
      </div>
    {:else}
      {#each visibleSteps as step, i}
        <div
          class="step-item"
          role="listitem"
          class:done={i < currentStepIndex}
          class:active={i === currentStepIndex}
          class:last={i === visibleSteps.length - 1}
          style="--i: {i}"
        >
          {#if slim}
            <!-- 슬림형: 원형 배지(기존 점의 4배) 안에 상태 텍스트를 넣는다 -->
            <div class="step-circle" aria-label={step.label}>
              <span class="step-circle-text">{#each badgeLines(step.label) as line}<span>{line}</span>{/each}</span>
            </div>
          {:else}
            <div class="step-dot-wrap">
              <div class="step-dot"></div>
            </div>
            <span class="step-label">{step.label}</span>
          {/if}
        </div>
        {#if i < visibleSteps.length - 1}
          <div class="step-connector" class:done={i < currentStepIndex} style="--i: {i}">
            {#if slim && i === currentStepIndex}
              <!-- 현재 단계 오른쪽 화살표 — 화살표 모양 마스크 안에서 옅은 퍼플 줄무늬가 왼쪽→오른쪽으로 반복해서 흐른다.
                   transform 만 움직여 합성기에서 처리한다(이전 SVG SMIL·그라데이션 방식은 매 프레임 다시 그려 버벅임의 원인, 2026-10-22 성능). 고유 id 도 필요 없다. -->
              <span class="wave-arrow" aria-hidden="true"><span class="wave-strip"></span></span>
            {:else}
              <svg class="step-connector-icon" viewBox="0 0 15 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path fill="currentColor" d="M6 1.50201C6.00016 0.347444 7.25006 -0.374122 8.25 0.203186L13.5 3.23444C14.4999 3.81179 14.4999 5.25471 13.5 5.83209L8.25 8.86334C7.25003 9.44068 6.00007 8.71916 6 7.56451V6.69733L2.25 8.86334C1.25003 9.44068 7.20656e-05 8.71916 0 7.56451V1.50201C0.000159498 0.347444 1.25006 -0.374122 2.25 0.203186L6 2.36823V1.50201Z"/>
              </svg>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
  {#if children}
    <div class="stepper-extra">{@render children()}</div>
  {/if}
</div>

<style>
  /* Mobile base (-20%) */
  /* 박스(배경·라운드·패딩) 전용 — 스크롤·마스크는 안쪽 .stepper-scroll에서만 처리해
     좌우 페이드 적용 시 이 박스의 배경·모서리는 그대로 유지되도록 분리 */
  .journey-stepper {
    /* 모바일: 좌우 여백을 상하(22px)와 동일하게 통일(기존 14px는 박스 모서리에 너무 붙어 보임) */
    padding: 22px;
    background: var(--cs-surface-gray);
    border-radius: 30px;
  }
  /* 상하 패딩 50% 축소(좌우는 유지) — 반응형 padding 규칙보다 우선하도록 클래스 2개 */
  .journey-stepper.compact { padding-top: 11px; padding-bottom: 11px; background: var(--cs-bg-row-hover); /* 더 옅은 회색(#fafafa) */ }
  /* 박스 상단 좌측 상품명 — 기존 박스 바깥에 있던 문구를 박스 안으로 재배치 */
  .stepper-product-name {
    font-family: var(--font-kr);
    font-weight: 700;
    color: var(--cs-text);
    font-size: 14px;
    letter-spacing: -0.3px;
    margin: 0 0 8px;
  }
  .stepper-scroll {
    display: flex;
    /* step-dot-wrap(35px 원형 박스)과 step-connector(같은 높이로 통일)를 같은 상단 기준선에
       놓아 정확히 수평 중앙이 맞도록 함 — align-items:center는 라벨 유무로 높이가 다른
       step-item과 step-connector를 잘못 정렬시킴(margin-bottom 보정 방식은 부정확) */
    align-items: flex-start;
    /* 일반 center 금지 — overflow-x:auto와 함께 쓰면 콘텐츠가 좌우로 균등하게 넘치면서
       브라우저 초기 스크롤 위치가 중앙으로 잡혀 양쪽 끝이 잘려 보이는 문제 발생.
       safe center: 다 들어갈 땐 중앙 정렬, 넘칠 땐 자동으로 flex-start처럼 동작(잘림 방지) */
    justify-content: safe center;
    flex-wrap: nowrap;
    overflow-x: auto;
    /* 스크롤바를 시각적으로 숨기고 터치 드래그 스크롤만 남김(overflow-x:auto 자체는 유지되어
       터치 스와이프로 계속 스크롤 가능 — 구식 스크롤바 바 노출만 제거) */
    scrollbar-width: none;
    -ms-overflow-style: none;
    /* 모바일: 좌우 끝 스텝이 스크롤되며 부드럽게 사라지는 느낌(알파 그라데이션 마스크) */
    -webkit-mask-image: linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent);
    mask-image: linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent);
  }
  .stepper-scroll::-webkit-scrollbar {
    display: none;
  }
  /* 취소됨 좌측 배치 — 좌측 끝 페이드 마스크를 끄지 않으면 라벨이 흐려진다 */
  .stepper-scroll.cancelled-start {
    justify-content: flex-start;
    -webkit-mask-image: none;
    mask-image: none;
  }
  /* children 슬롯 — 박스 안 단계 표시 아래 */
  .stepper-extra { margin-top: 16px; }
  .stepper-extra:empty { display: none; }
  .step-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    /* 노출 모션(2026-10-22, 슬림형과 동일): 패널·카드가 열릴 때 단계가 아래에서 위로 올라오며 왼쪽부터 차례로 나타남(1회) */
    animation: step-in 0.5s cubic-bezier(0.34, 1.3, 0.64, 1) backwards;
    animation-delay: calc(var(--i, 0) * 70ms);
  }
  .step-dot-wrap {
    display: grid;
    place-items: center;
    width: 35px;
    height: 35px;
    border-radius: 50%;
    background: var(--cs-surface-gray);
    flex-shrink: 0;
  }
  .step-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--cs-lilac);
    border: 2px solid var(--cs-text-light);
    transition: background 0.15s, border-color 0.15s;
  }
  .step-item.done .step-dot {
    background: var(--cs-purple);
    border-color: var(--cs-purple);
  }
  .step-item.active .step-dot {
    background: var(--cs-white);
    border-color: var(--cs-purple);
    box-shadow: 0 0 0 5px rgba(59,47,138,0.2);
  }
  .step-label {
    font-family: var(--font-kr);
    font-size: var(--text-m-script-14B);
    color: var(--cs-text-light);
    white-space: nowrap;
  }
  .step-item.done .step-label  { color: var(--cs-purple); font-weight: 700; }
  .step-item.active .step-label { color: var(--cs-purple-dark); font-weight: 700; }
  .step-connector {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 37px;
    height: 35px; /* step-dot-wrap과 동일 높이 — flex-start 기준선에서 자동으로 수평 중앙 정렬 */
    color: var(--cs-purple-pale);
    transition: color 0.15s;
    animation: step-in 0.4s ease-out backwards;
    animation-delay: calc(var(--i, 0) * 60ms + 30ms);
  }
  .step-connector.done { color: var(--cs-purple); }
  .step-connector-icon {
    width: 18px;
    height: 12px;
    flex-shrink: 0;
  }

  /* ── 슬림형(패널 헤더, 2026-10-22) — 원형 배지(기존 점 12px의 4배=48px) 안에 상태 텍스트. 색·화살표 아이덴티티는 기본형 그대로 ── */
  .journey-stepper.slim { padding: 16px 18px; border-radius: 30px; } /* 상하 여백 확대(회전 호·글로가 박스 가장자리에 닿지 않게) */
  .journey-stepper.slim .stepper-scroll { align-items: center; justify-content: center; overflow: visible; -webkit-mask-image: none; mask-image: none; } /* 현재 단계 링·글로가 위아래로 잘리지 않게 overflow 를 풀어 둔다(CMS PC 전용) */
  .journey-stepper.slim .step-item { flex-direction: row; gap: 0; animation: step-in 0.5s cubic-bezier(0.34, 1.3, 0.64, 1) backwards; animation-delay: calc(var(--i, 0) * 70ms); }
  .journey-stepper.slim .step-connector { width: var(--conn, 46px); height: var(--circle, 48px); animation: step-in 0.4s ease-out backwards; animation-delay: calc(var(--i, 0) * 60ms + 30ms); }
  .journey-stepper.slim .step-connector-icon { width: 14px; height: 9px; }

  /* 고객 화면용 fluid(2026-10-22, Stephen 지시 — CMS 헤더와 같은 원형 배지·모션을 고객 화면에도): 컨테이너 폭(cqw)에 맞춰 배지 크기를 34~46px 로 줄인다.
     배지 수는 --n(스텝 수). 아주 좁으면 가로 스크롤(회전 호가 잘리지 않게 위아래 여백을 둔다). */
  .journey-stepper.slim.fluid { container-type: inline-size; padding: 24px 18px; } /* 상하 14px → 24px(2026-10-22, 박스가 답답해 보인다는 지적) */
  .journey-stepper.slim.fluid .stepper-scroll {
    /* 2026-10-22(후속): 배지를 34px까지 줄여 촘촘해지고 그래도 끝 배지가 잘리던 문제 → 배지는 50~55px 아래로 줄이지 않고(폭이 넉넉하면 55px까지),
       간격은 남는 폭만큼 44~56px로 늘린다. 그래도 모자라면(좁은 폰) 더 줄이지 않고 가로로 밀어 보게 한다(현재 단계는 가운데로 자동 이동) */
    --circle: clamp(50px, calc((100cqw - (var(--n) - 1) * 44px) / var(--n)), 55px); /* 2026-10-22: 42~46px → 50~55px(+20%) */
    --conn: clamp(44px, calc((100cqw - var(--n) * var(--circle)) / (var(--n) - 1)), 56px); /* 배지 사이 최소 44px(2026-10-22 재조정: 18→30→44px, 촘촘해 보인다는 지적) */
    /* 회전 호(6px)·글로(5px)가 좌우·상하 끝에서 잘리지 않게 사방 12px 여백을 두고, 같은 만큼 음수 마진으로 되돌려 레이아웃 폭은 그대로 둔다(2026-10-22) */
    overflow-x: auto; overflow-y: hidden; padding: 12px; margin: -12px;
    justify-content: safe center;
  }
  .journey-stepper.slim.fluid .step-connector-icon, .journey-stepper.slim.fluid .wave-arrow { width: 16px; height: 10px; }
  /* 넘칠 때만 좌우 끝 흐림(밀어서 더 볼 수 있다는 단서) — 슬림형의 mask 해제 규칙보다 우선하도록 클래스 4개 */
  /* 상품명 ↔ 원형 배지 줄 사이 여백(8px → 12px → 20px, 2026-10-22 추가 확대) — 고객 화면(fluid)만, CMS 헤더 불변 */
  .journey-stepper.slim.fluid .stepper-product-name { margin-bottom: 20px; }
  .journey-stepper.slim.fluid .stepper-scroll.fade {
    -webkit-mask-image: linear-gradient(to right, transparent, #000 18px, #000 calc(100% - 18px), transparent);
    mask-image: linear-gradient(to right, transparent, #000 18px, #000 calc(100% - 18px), transparent);
  }
  /* PC 반응형(≥768px)에서는 배지 사이 여백을 넓힌다 — 컨테이너 폭에 비례(7.5%, 18~40px), 배지는 남은 폭에 맞춰 34~46px */
  @media (min-width: 768px) {
    .journey-stepper.slim.fluid .stepper-scroll { --circle: clamp(34px, calc((100cqw - (var(--n) - 1) * var(--conn)) / var(--n)), 46px); --conn: clamp(18px, 7.5cqw, 40px); }
    .journey-stepper.slim.fluid .step-connector-icon, .journey-stepper.slim.fluid .wave-arrow { width: 14px; height: 9px; }
  }

  /* 현재 단계 화살표 물결 — 마스크(화살표 모양) 안의 줄무늬를 translateX 로만 이동(합성기 처리) */
  .wave-arrow {
    display: block;
    width: 14px;
    height: 9px;
    overflow: hidden;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 15 10'%3E%3Cpath d='M6 1.50201C6.00016 0.347444 7.25006 -0.374122 8.25 0.203186L13.5 3.23444C14.4999 3.81179 14.4999 5.25471 13.5 5.83209L8.25 8.86334C7.25003 9.44068 6.00007 8.71916 6 7.56451V6.69733L2.25 8.86334C1.25003 9.44068 7.20656e-05 8.71916 0 7.56451V1.50201C0.000159498 0.347444 1.25006 -0.374122 2.25 0.203186L6 2.36823V1.50201Z'/%3E%3C/svg%3E") center / 100% 100% no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 15 10'%3E%3Cpath d='M6 1.50201C6.00016 0.347444 7.25006 -0.374122 8.25 0.203186L13.5 3.23444C14.4999 3.81179 14.4999 5.25471 13.5 5.83209L8.25 8.86334C7.25003 9.44068 6.00007 8.71916 6 7.56451V6.69733L2.25 8.86334C1.25003 9.44068 7.20656e-05 8.71916 0 7.56451V1.50201C0.000159498 0.347444 1.25006 -0.374122 2.25 0.203186L6 2.36823V1.50201Z'/%3E%3C/svg%3E") center / 100% 100% no-repeat;
  }
  .wave-strip {
    display: block;
    width: 200%;
    height: 100%;
    background: linear-gradient(90deg, var(--cs-purple-pale) 0%, var(--cs-purple-light) 25%, var(--cs-purple-pale) 50%, var(--cs-purple-light) 75%, var(--cs-purple-pale) 100%);
    transform: translateX(-50%);
    animation: wave-flow 1.3s linear infinite;
    will-change: transform;
  }
  @keyframes wave-flow { to { transform: translateX(0); } }

  .step-circle {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--circle, 48px);
    height: var(--circle, 48px);
    border-radius: 50%;
    box-sizing: border-box;
    background: var(--cs-lilac);
    border: 2px solid transparent; /* 비활성 배지는 아웃라인 없음 — 활성·지난 단계만 테두리색을 입힌다(크기 유지용 투명 테두리) */
    color: var(--cs-text-light);
    text-align: center;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .step-circle-text {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    font: var(--text-pc-tag-11); /* 배지 레이블 토큰 700 11px — 글자 토큰 중 배지용 최소 */
    line-height: 1.15;
    letter-spacing: -0.3px;
    white-space: nowrap;
  }
  .step-item.done .step-circle { background: var(--cs-purple); border-color: var(--cs-purple); color: var(--cs-white); }
  .step-item.active .step-circle { background: var(--cs-white); /* 퍼플 테두리 제거(2026-10-22) — 흰 배경 + 회전 호로 현재 단계를 구분 */ color: var(--cs-purple-dark); animation: step-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s backwards; }
  /* 마지막 단계(반납완료)가 현재일 때만(2026-10-22, Stephen 지시): 패널 오픈 시 호·글로 2회만 반복한 뒤 활성 배경(퍼플 채움)으로 전환 — 다른 단계의 현재 배지는 위의 계속 반복 모션 그대로 */
  .step-item.active.last .step-circle { animation: step-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s backwards, step-fill 0.5s ease 4.6s forwards; }
  /* 현재 단계 — 원 바깥을 도는 그라데이션 호(진행 링). 옅은 퍼플 → 퍼플 꼬리, 마스크로 링 모양만 남긴다 */
  .step-item.active .step-circle::before {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    background: conic-gradient(from 0deg, transparent 0 35%, var(--cs-purple-pale) 60%, var(--cs-purple-light) 100%);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
    animation: step-orbit 2.2s linear infinite;
    will-change: transform;
    pointer-events: none;
  }
  .step-item.active.last .step-circle::before { animation: step-orbit 2.2s linear 0.2s 2, step-arc-out 0.4s ease 4.6s forwards; }
  /* 숨 쉬는 글로 — 정적인 그림자를 가진 겹침 요소의 opacity·transform 만 움직여 합성기에서 처리(매 프레임 다시 그리지 않는다, 2026-10-22 성능) */
  .step-item.active .step-circle::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 5px rgba(59,47,138,0.14);
    animation: step-glow 3s ease-in-out 0.8s infinite backwards;
    will-change: transform, opacity;
    pointer-events: none;
  }
  .step-item.active.last .step-circle::after { animation: step-glow 2.2s ease-in-out 0.2s 2 backwards, step-arc-out 0.4s ease 4.6s forwards; }

  /* 패널을 열 때 단계가 아래에서 위로 올라오며 왼쪽부터 차례로 나타남(1회, 스프링 곡선) */
  @keyframes step-in {
    0%   { opacity: 0; transform: translateY(22px) scale(0.8); } /* 아래에서 위로 올라오며 나타남 — 단계마다 지연(--i)이 달라 좌→우로 차례로 펼쳐진다 */
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  /* 현재 단계 원 — 스프링 팝(1회) */
  @keyframes step-pop {
    0%   { transform: scale(0.7); }
    100% { transform: scale(1); }
  }
  /* 현재 단계 원 — 천천히 숨 쉬는 옅은 퍼플 글로(반복) */
  @keyframes step-glow {
    0%, 100% { opacity: 0.9; transform: scale(1); }
    50%      { opacity: 0.25; transform: scale(1.14); }
  }
  @keyframes step-orbit {
    to { transform: rotate(360deg); }
  }
  /* 호가 2바퀴를 마치면 부드럽게 사라진다 */
  @keyframes step-arc-out {
    to { opacity: 0; }
  }
  /* 모션이 끝나면 현재 단계 배지가 활성 배경(퍼플)·흰 글자로 전환 */
  @keyframes step-fill {
    to { background: var(--cs-purple); color: var(--cs-white); }
  }
  @media (prefers-reduced-motion: reduce) {
    .step-item, .step-connector { animation: none; }
    .journey-stepper.slim .step-item, .journey-stepper.slim .step-connector, .step-item.active .step-circle, .step-item.active .step-circle::before { animation: none; }
    .step-item.active.last .step-circle { animation: none; background: var(--cs-purple); color: var(--cs-white); } /* 동작 줄이기: 마지막 단계는 모션 없이 바로 활성 배경 */
    .step-item.active .step-circle::before, .step-item.active .step-circle::after { display: none; }
    .wave-strip { animation: none; transform: translateX(-25%); }
  }

  /* 취소 상태 */
  .journey-cancelled {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cancelled-icon {
    width: 18px; height: 18px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    background: var(--cs-error, #ef4444);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .cancelled-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-error, #ef4444);
  }

  /* PC 반응형 (-20%) */
  @media (min-width: 768px) {
    .journey-stepper { padding: 22px 18px; }
    /* PC는 이번 요청 범위 밖 — 좌우 페이드 마스크는 모바일 전용으로 유지 */
    .stepper-scroll {
      -webkit-mask-image: none;
      mask-image: none;
    }
    .step-item { gap: 9px; }
    .step-dot-wrap { width: 42px; height: 42px; }
    .step-dot { width: 19px; height: 19px; border-width: 2px; }
    .step-item.active .step-dot { box-shadow: 0 0 0 6px rgba(59,47,138,0.2); }
    .step-label { font-size: var(--text-pc-body-14); }
    .step-connector { width: 42px; height: 42px; }
  }
</style>
