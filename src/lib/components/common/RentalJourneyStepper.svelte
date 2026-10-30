<script lang="ts">
  import { tick, type Snippet } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import { DHERO_STAGE_LABELS, type DheroStageInfo, type DheroTone } from '$lib/utils/dheroJourneyStage'

  interface Props {
    status: string
    steps?: string[]  // 표시할 status 값 목록 — 미지정 시 전체 6단계
    productName?: string  // bg 박스 상단 좌측에 표시할 대여 상품명(선택 — 미지정 시 미노출)
    compact?: boolean                  // 박스 상하 패딩 50% 축소(22→11px) — CMS 취소·환불 사유 박스용, 기본 false
    cancelledLabel?: string            // 취소 상태 문구(기본 '취소됨' — CMS 취소·환불 사유 박스는 '취소사유등록')
    cancelledAlign?: 'center' | 'start'  // 취소됨 표시 위치(기본 center — CMS 취소·환불 사유 박스는 start=좌측)
    returnDay?: 'before' | 'reached'   // 고객 화면 전용(2026-10-22): 대여중일 때만 의미 — before=대여중이 현재·반납중 칸은 비활성(기존 표시), reached=반납 안내 시각 도달(칸 이름이 '반납일'로 바뀌며 현재 단계). 고객이 반납 제출하면 상태가 반납중이 되어 이름만 '반납중'으로 바뀜
    fluid?: boolean                    // slim 과 함께 — 고객 화면용: 컨테이너 폭에 맞춰 원형 배지·간격이 줄어든다(34~46px). 기본 false(CMS 헤더는 고정 48px)
    plain?: boolean                    // 고객 대여카드용(2026-10-30): 회색 박스 배경·라운드·패딩을 없애 카드(흰색) 위에 그대로 놓는다 — 설명 말풍선은 흰 카드와 구분되도록 옅은 회색 면. 기본 false
    slim?: boolean                     // 패널 헤더용 슬림형 — 한 줄(점+라벨 가로 배치), 현재 단계 점에 옅은 퍼플 물결 모션 반복(2026-10-22). 기본 false
    details?: Record<string, string[] | undefined>  // 고객 화면 전용(2026-10-26): 단계별(status 키) 설명 텍스트 — 주어지면 해당 단계 배지를 눌러 선택할 수 있고, 선택한 단계의 텍스트가 배지 줄 아래에 나온다. 미지정 시 기존과 동일(비선택)
    children?: Snippet    // bg 박스 안, 단계 표시 아래에 넣을 추가 콘텐츠(선택 — CMS 취소·환불 사유 입력 등, 미지정 시 기존과 동일)
    /** 두발히어로 배송 5단계 진행 정보 — 지정 시 반출중(shipped) 배지를 클릭 가능 토글로 변환해 5단계를 펼친다(slim 모드만) */
    dheroStage?: DheroStageInfo | null
  }

  let { status, steps, productName, children, cancelledAlign = 'center', cancelledLabel, compact = false, plain = false, slim = false, fluid = false, returnDay, details, dheroStage = null }: Props = $props()

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

  // 장바구니에 담기만 한 임시예약(draft)은 맨 앞에 '장바구니' 원형 배지를 둔다(2026-10-26, Stephen 지시 — '장바구니에 담긴 상품'임을 알리는 UI).
  // 이 배지가 현재 단계(활성 모션·화살표 물결)이고, 예약신청이 등록되면(hold) 배지는 사라지고 기존 단계 흐름으로 이어진다. CMS 목록의 '임시예약' 배지와 같은 개념.
  let displaySteps = $derived(status === 'draft' ? [{ status: 'cart', label: '장바구니' }, ...visibleSteps] : visibleSteps)

  let currentStepIndex = $derived(
    status === 'completed'
      ? displaySteps.length - 1
      : displaySteps.findIndex(s => s.status === (returnDay === 'reached' && status === 'in_use' ? 'return_requested' : status === 'draft' ? 'cart' : status))
  )

  // 슬림형 원형 배지 안 텍스트 — 4글자 이상은 반으로 나눠 두 줄(계약/완료), 3글자 이하는 한 줄
  function badgeLines(label: string): string[] {
    if (label.length < 4) return [label]
    const h = Math.ceil(label.length / 2)
    return [label.slice(0, h), label.slice(h)]
  }

  let isCancelled = $derived(status === 'cancelled' || status === 'damage_claimed')

  // 두발히어로 배송 5단계 펼침/접힘 상태
  let isDheroExpanded = $state(false)
  // 퇴장 애니메이션 진행 중 — 서브배지가 DOM 에 있지만 dhero-leaving 클래스로 퇴장 모션 재생
  let isDheroLeaving = $state(false)
  // 퇴장 타이머 — m-1: unmount/prop 변경 시 clearTimeout 해제
  let dheroLeaveTimer = $state<ReturnType<typeof setTimeout> | null>(null)

  // status 또는 dheroStage prop 이 실제로 바뀔 때만 펼침 상태 초기화 (m-3: 값 비교 — invalidateAll로 새 객체가 와도 값이 같으면 펼침 상태 유지)
  let _prevStatus = $state('')
  let _prevDheroKey = $state('')
  $effect(() => {
    const newStatus = status
    const newKey = `${dheroStage?.index ?? -1}/${dheroStage?.label ?? ''}/${dheroStage?.tone ?? ''}`
    if (newStatus !== _prevStatus || newKey !== _prevDheroKey) {
      _prevStatus = newStatus
      _prevDheroKey = newKey
      isDheroExpanded = false
      isDheroLeaving = false
      if (dheroLeaveTimer !== null) { clearTimeout(dheroLeaveTimer); dheroLeaveTimer = null }
    }
  })

  // m-1: 컴포넌트 언마운트 시 퇴장 타이머 정리
  $effect(() => {
    return () => {
      if (dheroLeaveTimer !== null) clearTimeout(dheroLeaveTimer)
    }
  })

  /** 서브배지를 퇴장 애니메이션과 함께 접힘 처리 (M4) */
  function collapseDhero(): void {
    // m-1: 이미 진행 중인 타이머가 있으면 먼저 취소
    if (dheroLeaveTimer !== null) { clearTimeout(dheroLeaveTimer); dheroLeaveTimer = null }
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    if (reducedMotion) {
      isDheroExpanded = false
      isDheroLeaving = false
      return
    }
    isDheroLeaving = true
    dheroLeaveTimer = setTimeout(() => {
      isDheroExpanded = false
      isDheroLeaving = false
      dheroLeaveTimer = null
    }, 180)
  }

  // 렌더 단계 목록 — isDheroExpanded 또는 isDheroLeaving 시 현재 status 스텝을 5개 서브스텝으로 교체
  interface DheroSubStep { status: string; label: string; isDheroSub: true; dheroIndex: number; tone?: DheroTone }
  type RenderStep = { status: string; label: string; isDheroSub?: undefined } | DheroSubStep

  // dhero 펼침은 shipped 또는 return_requested 상태에서 활성
  let dheroActive = $derived(dheroStage !== null && (status === 'shipped' || status === 'return_requested'))

  let renderSteps = $derived<RenderStep[]>(
    (isDheroExpanded || isDheroLeaving) && dheroActive
      ? displaySteps.flatMap((s): RenderStep[] =>
          s.status === status
            ? (DHERO_STAGE_LABELS as readonly string[]).map((label, idx): RenderStep => ({
                status: `dhero_${idx}`,
                // 현재 단계 서브배지는 dheroStage.label(세부 라벨) 사용 (M2)
                label: idx === dheroStage!.index ? dheroStage!.label : label,
                isDheroSub: true,
                dheroIndex: idx,
                // 현재 단계 서브배지에만 tone 전달 (M2)
                tone: idx === dheroStage!.index ? dheroStage!.tone : undefined,
              }))
            : [s]
        )
      : (displaySteps as RenderStep[])
  )

  // 렌더 단계 기준 현재 인덱스 (dhero 펼침 시 현재 status 기준 위치 + dheroStage.index)
  let renderCurrentIndex = $derived(
    isDheroExpanded && dheroActive
      ? (() => {
          const base = displaySteps.findIndex(s => s.status === status)
          return base >= 0 ? base + dheroStage!.index : currentStepIndex
        })()
      : currentStepIndex
  )

  // 단계 배지 선택 → 배지 줄 아래 설명 텍스트(details 가 있을 때만). 같은 배지를 다시 누르면 닫힌다.
  let selectedKey = $state<string | null>(null)
  const infoId = `journey-info-${Math.random().toString(36).slice(2, 8)}`
  function stepKey(step: { status: string }): string {
    // '반납일'로 이름이 바뀐 칸(returnDay=reached)도 데이터 키는 return_requested
    return step.status
  }
  function isSelectable(step: { status: string }): boolean {
    return !!details && !!details[stepKey(step)] && step.status !== 'cart'
  }
  function toggleStep(step: { status: string }): void {
    if (!isSelectable(step)) return
    const k = stepKey(step)
    selectedKey = selectedKey === k ? null : k
  }
  let selectedLines = $derived(details && selectedKey ? (details[selectedKey] ?? []) : [])

  // 자동 펼침(2026-10-30, Stephen 지시): 배지를 누르지 않아도 "현재 단계"의 설명이 처음부터 말풍선으로 떠 있다.
  // 단계(status)나 현재 단계의 설명 유무가 바뀔 때만 다시 맞추고, invalidateAll 로 details 객체만 새로 와도 고객이 고른 선택은 유지한다.
  let _autoSig = ''
  $effect(() => {
    const cur = displaySteps[currentStepIndex]
    const key = details && cur && cur.status !== 'cart' && details[cur.status] ? cur.status : null
    const sig = `${status}|${key ?? ''}`
    if (sig === _autoSig) return
    _autoSig = sig
    selectedKey = key
  })

  // 설명 줄 중 "운송장 번호: 값" 은 번호 부분을 누르면 복사된다(2026-10-30, Stephen 지시)
  function splitTracking(line: string): { label: string; value: string } | null {
    const m = /^(운송장 번호:\s*)(\S.*)$/.exec(line)
    return m ? { label: m[1], value: m[2].trim() } : null
  }
  async function copyTracking(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // 클립보드 권한이 없는 환경(일부 인앱 브라우저·http) — 임시 입력칸으로 복사
      try {
        const ta = document.createElement('textarea')
        ta.value = value
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('copy failed')
      } catch {
        csToast.error('복사하지 못했어요. 번호를 길게 눌러 직접 복사해 주세요.')
        return
      }
    }
    csToast.success('운송장번호를 복사했습니다.')
  }

  // 말풍선 꼬리 — 선택한 배지(원형)의 가로 중앙을 말풍선 박스 왼쪽 기준 px 로 잰다. 배지 줄이 밀려 스크롤돼도 따라가도록 스크롤·크기 변화 때 다시 잰다.
  // 두 요소의 실제 화면 좌표 차이로 구해 padding·스크롤·offsetParent 차이에 영향받지 않는다(진입 모션은 scale·세로 이동이라 가로 중앙은 같다 — 모션 끝나면 한 번 더 잰다).
  let tailX = $state<number | null>(null)
  function updateTail(): void {
    const el = stepperEl
    const info = document.getElementById(infoId)
    if (!el || !info || !selectedKey) { tailX = null; return }
    // dhero 펼침 중에는 선택 단계 배지가 5개 서브배지로 바뀌므로 현재 서브배지를 가리킨다
    const target = el.querySelector<HTMLElement>('.step-item.selected') ?? (selectedKey === status ? el.querySelector<HTMLElement>('.step-item.active') : null)
    const circle = target?.querySelector<HTMLElement>('.step-circle')
    if (!circle) { tailX = null; return }
    const c = circle.getBoundingClientRect()
    tailX = c.left + c.width / 2 - info.getBoundingClientRect().left
  }
  $effect(() => {
    void selectedKey; void status; void renderSteps; void selectedLines; void isDheroExpanded
    if (!stepperEl) return
    tick().then(updateTail)
    document.fonts?.ready.then(updateTail)
    window.addEventListener('resize', updateTail)
    return () => window.removeEventListener('resize', updateTail)
  })

  // 모바일 아코디언 등 늦게 렌더링/확장되는 컨테이너에 들어갈 때 overflow-x 스크롤 위치가
  // 0이 아닌 상태로 초기화되어 좌측이 잘려 보이는 문제 방지 — 항상 맨 왼쪽(신청 단계)부터 보이도록 고정
  let stepperEl = $state<HTMLDivElement | null>(null)
  // 고객 화면 fluid(모바일): 배지를 줄이지 않고 가로로 밀어 보는 띠로 두고, 현재 단계를 가운데로 맞춘다. 넘칠 때만 좌우 끝을 흐리게(fade).
  let fade = $state(false)
  $effect(() => {
    status
    void returnDay // 대여중 → '반납일' 전환·steps 변경으로 현재 단계 위치가 바뀌어도 다시 가운데로 맞춘다(sp3 MINOR-3)
    void steps
    void isDheroExpanded // dhero 펼침/접힘으로 현재 단계 배지 위치가 바뀔 때도 다시 가운데로
    if (!stepperEl) return
    const el = stepperEl
    if (!fluid && !slim) { el.scrollLeft = 0; return } // slim(CMS 헤더)도 좁은 패널에서 현재 단계를 가운데로 맞춘다(2026-10-23)
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
      el.scrollTo?.({ left: x + active.offsetWidth / 2 - el.clientWidth / 2, behavior: 'instant' }) // ?. — jsdom(컴포넌트 테스트)에는 scrollTo 가 없다
    }
    sync()
    document.fonts?.ready.then(sync)
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  })
</script>

<div class="journey-stepper" class:compact class:plain class:slim class:fluid>
  {#if productName}
    <p class="stepper-product-name">{productName}</p>
  {/if}
  <div class="stepper-scroll" style="--n: {renderSteps.length}" class:fade class:cancelled-start={isCancelled && cancelledAlign === 'start'} role="list" aria-label="대여 여정" bind:this={stepperEl} onscroll={updateTail} onanimationend={updateTail}>
    {#if isCancelled}
      <div class="journey-cancelled">
        <span class="cancelled-icon">✕</span>
        <span class="cancelled-label">
          {status === 'damage_claimed' ? '파손신고' : (cancelledLabel ?? '취소됨')}
        </span>
      </div>
    {:else}
      {#each renderSteps as step, i}
        <div
          class="step-item"
          role="listitem"
          class:done={i < renderCurrentIndex}
          class:active={i === renderCurrentIndex}
          class:last={i === renderSteps.length - 1}
          class:selected={isSelectable(step) && selectedKey === stepKey(step)}
          class:dhero-step={!!step.isDheroSub}
          style="--i: {i}"
        >
          {#if slim}
            <!-- 슬림형: 원형 배지(기존 점의 4배) 안에 상태 텍스트를 넣는다 -->
            {#if step.status === status && dheroActive}
              <!-- 두발히어로 배송(반출중) 또는 회수(반납중) 접힘 토글 — 해당 단계 배지 뒤에 ghost 원이 겹쳐 보이는 효과 -->
              <div class="dhero-stack-wrap">
                <button
                  type="button"
                  class="step-circle dhero-toggle"
                  aria-label={`두발히어로 ${status === 'return_requested' ? '반납' : '배송'} 단계 펼치기${dheroStage ? ` (현재: ${dheroStage.label})` : ''}`}
                  aria-expanded={isDheroExpanded}
                  data-tone={dheroStage?.tone}
                  onclick={() => {
                    isDheroExpanded = true
                    // M1: details 가 있으면 함께 열기 — dheroStage 없을 때와 동일한 details 동작 유지
                    if (isSelectable(step)) selectedKey = stepKey(step)
                  }}
                >
                  <span class="step-circle-text">{#each badgeLines(step.label) as line}<span>{line}</span>{/each}</span>
                </button>
              </div>
            {:else if step.isDheroSub}
              <!-- 두발히어로 배송 펼침 서브스텝 — 클릭 시 퇴장 애니메이션 후 접힘 -->
              <button
                type="button"
                class="step-circle dhero-sub-circle"
                class:dhero-leaving={isDheroLeaving}
                aria-label={`${step.label} — 두발히어로 ${status === 'return_requested' ? '반납' : '배송'} 단계 접기`}
                data-tone={step.tone}
                onclick={() => { collapseDhero(); selectedKey = null }}
                style="--si: {step.dheroIndex}"
              >
                <span class="step-circle-text">{#each badgeLines(step.label) as line}<span>{line}</span>{/each}</span>
              </button>
            {:else if isSelectable(step)}
              <button
                type="button"
                class="step-circle selectable"
                aria-label={step.label}
                aria-pressed={selectedKey === stepKey(step)}
                aria-controls={infoId}
                onclick={() => toggleStep(step)}
              >
                <span class="step-circle-text">{#each badgeLines(step.label) as line}<span>{line}</span>{/each}</span>
              </button>
            {:else}
              <div class="step-circle" aria-label={step.label}>
                <span class="step-circle-text">{#each badgeLines(step.label) as line}<span>{line}</span>{/each}</span>
              </div>
            {/if}
          {:else}
            <div class="step-dot-wrap">
              <div class="step-dot"></div>
            </div>
            <span class="step-label">{step.label}</span>
          {/if}
        </div>
        {#if i < renderSteps.length - 1}
          <div class="step-connector" class:done={i < renderCurrentIndex} style="--i: {i}">
            {#if slim && i === renderCurrentIndex}
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
  {#if details && selectedKey && selectedLines.length > 0}
    <!-- 선택한 단계 설명 — 처음엔 현재 단계가 자동으로 펼쳐지고, 말풍선 꼬리가 해당 배지를 가리킨다 -->
    <div class="step-info" id={infoId} role="status" aria-live="polite" style={tailX !== null ? `--tail-x: ${tailX}px` : undefined}>
      {#each selectedLines as line, li}
        {@const tracking = splitTracking(line)}
        <p class:step-info-lead={li === 0}>{#if tracking}{tracking.label}<button type="button" class="tracking-copy" title="눌러서 복사" onclick={() => copyTracking(tracking.value)}>{tracking.value}</button>{:else}{line}{/if}</p>
      {/each}
    </div>
  {/if}
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
  /* 단계 배지 선택 → 설명 텍스트(고객 화면) — 배경만으로 구분, 테두리·그림자 없음 */
  .step-circle.selectable { cursor: pointer; padding: 0; font: inherit; }
  .journey-stepper .step-item.selected .step-circle { background: var(--cs-purple-pale); color: var(--cs-purple-dark); }
  .journey-stepper .step-item.selected.done .step-circle { background: var(--cs-purple-dark); color: var(--cs-white); }
  .step-info {
    position: relative;
    margin-top: 21px; /* 배지 줄과의 간격 14px → 21px(+50%, 2026-10-30 Stephen 지시) */
    padding: 12px 14px;
    border-radius: 15px;
    background: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 13px;
    line-height: 1.5;
    color: var(--cs-text-mid);
    word-break: keep-all;
    /* 미세한 그림자(2026-10-30, Stephen 지시) — drop-shadow 라 박스와 꼬리가 하나의 윤곽으로 함께 그림자를 받는다. 색은 --shadow-bottom-bar 와 같은 text(#100B32) 계열 */
    filter: drop-shadow(0 1px 4px rgba(16, 11, 50, 0.08));
  }
  /* 말풍선 꼬리 — 선택한 배지 가로 중앙을 가리킨다(좌우 모서리 라운드 밖으로 나가지 않게 clamp). 면(white)만 쓰고 테두리·그림자 없음 */
  .step-info::before {
    content: '';
    position: absolute;
    top: -7px;
    left: clamp(22px, var(--tail-x, 50%), calc(100% - 22px));
    width: 16px;
    height: 8px;
    transform: translateX(-50%);
    background: var(--cs-white);
    clip-path: polygon(50% 0, 0 100%, 100% 100%);
  }
  /* 운송장 번호 — 퍼플 글자, 호버·터치는 글자색만 바뀐다(배경·테두리·밑줄 없음) */
  .tracking-copy {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-family: var(--font-en-d-din);  /* 숫자 폰트(D-DIN Exp, 2026-10-30 Stephen 지시) */
    font-size: 14px;                    /* 본문 13px → 14px(+1pt) */
    font-weight: 700;
    color: var(--cs-purple);
    cursor: pointer;
    transition: color 0.15s;
  }
  .tracking-copy:hover, .tracking-copy:active { color: var(--cs-purple-light); }
  .step-info p { margin: 0; }
  .step-info p + p { margin-top: 2px; }
  .step-info-lead { font-weight: 700; color: var(--cs-text); }
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
  /* CMS 헤더(slim, fluid 아님) 좁은 패널 대응(2026-10-23, Stephen 지시): 간트 상세처럼 패널이 좁으면 배지(48px)·간격(46px) 원래 크기를 유지한 채 회색 박스 안에서
     가로 띠로 두고(박스 밖으로 삐져나오지 않게 가로 overflow 를 막음), 현재 단계 배지가 가운데 오도록 스크립트가 자동 스크롤한다. 한눈에 다 보이지 않아도 된다.
     회전 호·글로가 잘리지 않게 사방 12px 여백 + 같은 만큼 음수 마진(fluid 와 동일 방식). 넓은 패널(예약목록 730px)은 다 들어가므로 기존과 동일 */
  .journey-stepper.slim:not(.fluid) .stepper-scroll { overflow-x: auto; overflow-y: hidden; padding: 12px; margin: -12px; justify-content: safe center; }
  .journey-stepper.slim:not(.fluid) .stepper-scroll.fade {
    -webkit-mask-image: linear-gradient(to right, transparent, #000 18px, #000 calc(100% - 18px), transparent);
    mask-image: linear-gradient(to right, transparent, #000 18px, #000 calc(100% - 18px), transparent);
  }

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
  /* PC 반응형(≥768px)에서는 배지 사이 여백을 넓힌다 — 컨테이너 폭에 비례(7.5%, 30~40px), 배지는 남은 폭에 맞춰 34~46px */
  @media (min-width: 768px) {
    .journey-stepper.slim.fluid .stepper-scroll { --circle: clamp(34px, calc((100cqw - (var(--n) - 1) * var(--conn)) / var(--n)), 46px); --conn: clamp(30px, 7.5cqw, 40px); } /* 배지 사이 최소 간격 18→30px(2026-10-26, Stephen 지시 — PC 폭이 좁아질 때 배지가 너무 붙어 보임). 모자라면 배지를 더 줄이지 않고 가로로 밀어 보는 띠(fade)로 전환 */
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
    .step-circle.dhero-sub-circle { animation: none; }
    .step-circle.dhero-sub-circle.dhero-leaving { animation: none; }
  }

  /* ── 두발히어로 배송 5단계 펼침/접힘 (slim 모드 전용, 2026-10-28) ── */

  /* dhero 서브스텝 step-item 진입 모션 비활성 — 개별 배지에 dhero-in 적용 */
  .step-item.dhero-step { animation: none; }

  /* ghost 겹침 효과 — 반출중 배지 뒤에 2개의 희미한 원이 겹쳐 보여 클릭 가능함을 암시 */
  /* isolation: isolate — 자체 stacking context 를 만들어 ::before/::after(z-index:-1/-2)가
     조상 stacking context(step-item animation) 에 의해 가려지지 않도록 봉인 (M4) */
  .dhero-stack-wrap {
    position: relative;
    isolation: isolate;
  }
  .dhero-stack-wrap::before,
  .dhero-stack-wrap::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--cs-lilac);
    border: 2px solid transparent;
    pointer-events: none;
  }
  /* 겹침 배지는 불투명 면 2장 — 반투명(0.45·0.25)은 패널 회색 배경(--cs-surface-gray)과 거의 같아져 보이지 않았다(2026-10-28 화면 확인).
     가까운 장은 더 진한 퍼플 톤(--cs-purple-op10), 먼 장은 --cs-lilac 로 구분해 부채처럼 펼쳐 보이게 한다 */
  .dhero-stack-wrap::before { background: var(--cs-purple-op10); transform: translate(6px, 3px); z-index: -1; }
  .dhero-stack-wrap::after  { background: var(--cs-lilac); transform: translate(12px, 6px); z-index: -2; }

  /* 두발히어로 토글 버튼 기본 */
  .step-circle.dhero-toggle {
    cursor: pointer;
    padding: 0;
    font: inherit;
  }
  /* warn tone — 활성 상태에서 노란 계열 강조 (M3: 하드코딩 색 → 토큰) */
  /* 읽은 절: front-uiux.md §1 lines 37-75 (색 토큰), app.css lines 100-103 (--cs-bg-warning 등) */
  .step-item.active .step-circle.dhero-toggle[data-tone="warn"] {
    background: var(--cs-bg-warning);   /* app.css:102 — #fff8e6 */
    color: var(--cs-text-warning);      /* app.css:103 — #a66000 */
  }
  /* danger tone — 활성 상태에서 붉은 계열 강조 (M3: 토큰 교체) */
  .step-item.active .step-circle.dhero-toggle[data-tone="danger"] {
    background: var(--cs-bg-error);     /* app.css:100 — #fff0f0 */
    color: var(--cs-error);             /* app.css:91  — #E53935 */
  }

  /* 펼침 서브스텝 배지 — 클릭하면 접힘, stagger 애니메이션 */
  .step-circle.dhero-sub-circle {
    cursor: pointer;
    padding: 0;
    font: inherit;
    animation: dhero-in 0.32s ease backwards;
    animation-delay: calc(var(--si, 0) * 40ms);
  }
  /* 서브배지 tone 스타일 (M2 + M3) */
  .step-item.active .step-circle.dhero-sub-circle[data-tone="warn"] {
    background: var(--cs-bg-warning);
    color: var(--cs-text-warning);
  }
  .step-item.active .step-circle.dhero-sub-circle[data-tone="danger"] {
    background: var(--cs-bg-error);
    color: var(--cs-error);
  }
  /* 퇴장 애니메이션 — 접힘 시 서브배지가 겹침 위치로 모이며 사라짐 (M4) */
  .step-circle.dhero-sub-circle.dhero-leaving {
    animation: dhero-out 0.18s ease forwards;
    /* 역방향 stagger: 뒤쪽 배지부터 사라짐 */
    animation-delay: calc((4 - var(--si, 0)) * 20ms);
  }
  @keyframes dhero-in {
    from { opacity: 0; transform: scale(0.7) translateY(6px); }
    to   { opacity: 1; transform: scale(1)   translateY(0); }
  }
  @keyframes dhero-out {
    from { opacity: 1; transform: scale(1)   translateY(0); }
    to   { opacity: 0; transform: scale(0.7) translateY(4px); }
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

  /* 박스 제거형(고객 대여카드) — 배경·라운드·패딩 없음. 말풍선은 흰 카드 위에서 보이도록 옅은 회색 면(그림자는 면 대비가 생겨 불필요) */
  .journey-stepper.slim.fluid.plain { background: none; border-radius: 0; padding: 0; }
  .journey-stepper.plain .step-info { background: var(--cs-surface-gray); filter: none; }
  .journey-stepper.plain .step-info::before { background: var(--cs-surface-gray); }
</style>
