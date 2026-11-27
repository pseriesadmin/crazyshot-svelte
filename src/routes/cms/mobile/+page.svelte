<script lang="ts">
  import { goto } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import { identifyQrPayload } from '$lib/utils/qrProductId'
  import { scrollPeek } from '$lib/utils/scrollPeek'
  import { tabScroller } from '$lib/utils/tabScroller'
  import MobileChatFab from '$lib/components/cms/MobileChatFab.svelte'
  import FabCountBadge from '$lib/components/cms/FabCountBadge.svelte'
  import { mobileNewRentals } from '$lib/stores/mobileNewRentals.svelte'
  import QrScannerOverlay from '$lib/components/common/QrScannerOverlay.svelte'
  import MobileDatePickerModal from '$lib/components/cms/MobileDatePickerModal.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // ── 카테고리 버튼·검색 → 상품 목록(서브 화면)으로 바로 이동해 결과를 보여 준다 ──
  let searchQuery = $state('')

  function goCategory(value: string): void {
    void goto(value === 'all' ? '/cms/mobile/products' : `/cms/mobile/products?category=${encodeURIComponent(value)}`)
  }
  function submitSearch(e: SubmitEvent): void {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return
    void goto(`/cms/mobile/products?q=${encodeURIComponent(q)}`)
  }

  // ── 대시보드: 진행 중 대여 한 장(합계 + 단계별 분포 막대) + 주목할 숫자 타일 2개 — 스크롤 없이 한 화면 ──
  // ── 날짜별 대시보드 — 가운데 위의 날짜를 누르면 달력 모달이 열리고, 고른 날짜의 건수로 바뀐다 ──
  // 고른 날짜(없으면 서버가 준 오늘)와 그 날짜의 건수(없으면 서버가 준 오늘 건수) — prop 값으로 $state를 초기화하지 않는다
  let pickedDate = $state<string | null>(null)
  let pickedCounts = $state<typeof data.counts | null>(null)
  const selectedDate = $derived(pickedDate ?? data.date)
  let loadingCounts = $state(false)
  let showDatePicker = $state(false)
  const c = $derived(pickedCounts ?? data.counts)

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
  function dateLabel(iso: string): string {
    const [y, m, d] = iso.split('-')
    const wd = WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]
    return `${y}.${m}.${d} (${wd})`
  }

  // 날짜를 고르지 않은 기본 상태 = '현재까지' 통합 수량. 날짜를 고르면 그 날짜 기준 수량.
  function resetDate(): void {
    showDatePicker = false
    pickedDate = null
    pickedCounts = null
  }

  async function pickDate(iso: string): Promise<void> {
    showDatePicker = false
    if (iso === pickedDate) return
    pickedDate = iso
    loadingCounts = true
    try {
      const res = await fetch(`/api/cms/mobile-dashboard?date=${encodeURIComponent(iso)}`)
      if (res.ok && pickedDate === iso) {
        const body = (await res.json()) as { counts?: typeof data.counts }
        if (body.counts) pickedCounts = body.counts
      }
    } catch {
      // 네트워크 오류는 직전 값 유지
    } finally {
      loadingCounts = false
    }
  }
  const activeTotal = $derived(c.confirmed + c.shipped + c.inUse + c.returning)

  interface Stage { key: string; label: string; value: number; href: string }
  const stages = $derived<Stage[]>([
    { key: 'confirmed', label: '계약완료', value: c.confirmed, href: '/cms/mobile/rentals?status=confirmed' },
    { key: 'shipped', label: '반출중', value: c.shipped, href: '/cms/mobile/rentals?status=shipped' },
    { key: 'inuse', label: '대여중', value: c.inUse, href: '/cms/mobile/rentals?status=in_use' },
    { key: 'returning', label: '반납중', value: c.returning, href: '/cms/mobile/rentals' },
  ])

  // ── 인터랙션 ──────────────────────────────────────────
  // ① 진입 시 숫자가 0에서 차오르고(count-up) 막대가 차례로 솟아오른다  ② 막대를 누르고 있는 동안 그 단계만 강조(나머지는 흐려짐)되고
  //   합계 자리에 그 단계 값이 뜬다  ③ 손을 떼면 해당 단계 대여 목록으로 이동
  let progress = $state(0) // 0 → 1
  $effect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { progress = 1; return }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900)
      progress = 1 - Math.pow(1 - t, 3)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })
  const n = (v: number): number => Math.round(v * progress)

  let activeKey = $state<string | null>(null)
  function preview(key: string): void {
    if (activeKey !== key) navigator.vibrate?.(6)
    activeKey = key
  }
  function release(): void {
    activeKey = null
  }
  const activeStage = $derived(stages.find((st) => st.key === activeKey) ?? null)

  // 막대(필러) 높이 — 가장 큰 단계를 100%로 보고 나머지를 비례, 최소 높이를 둬서 0건도 바닥에 보이게 한다. 진입 후 순서대로 솟아오른다.
  const maxVal = $derived(Math.max(1, ...stages.map((st) => st.value)))
  let ready = $state(false)
  $effect(() => {
    const t = setTimeout(() => { ready = true }, 80)
    return () => clearTimeout(t)
  })
  const pillarH = (v: number): number => Math.max(8, Math.round((v / maxVal) * 100))

  // ── QR 스캐너 ──────────────────────────────────────────
  let showQrScanner = $state(false)
  let fabPeek = $state(false)
  // 숨어 있는(peek) 아이콘을 터치하면 먼저 튀어나오는 모션(감쇠 스프링 0.5초)이 끝난 뒤, 누른 아이콘의 화면으로 이동한다
  const POP_MS = 500
  let popStart = 0
  let popPending = false
  function onFabPointerDown(): void {
    if (!fabPeek) return
    fabPeek = false
    popStart = performance.now()
    popPending = true
    navigator.vibrate?.(6)
  }
  function onFabClickCapture(e: MouseEvent): void {
    if (!popPending) return
    const el = (e.target as HTMLElement).closest('a, button') as HTMLElement | null
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    const wait = Math.max(0, POP_MS - (performance.now() - popStart))
    popPending = false
    setTimeout(() => { el.click() }, wait)
  }

  // 첫 화면 진입 시 플로팅 아이콘이 나타난 뒤 2초 뒤에 옆으로 절반 들어간다(peek). 스크롤을 내리면 다시 튀어나온다(scrollPeek).
  $effect(() => {
    const t = setTimeout(() => { fabPeek = true }, 2000)
    return () => clearTimeout(t)
  })

  function handleQrDetected(raw: string): boolean {
    const result = identifyQrPayload(raw)
    if (result.type === 'member') {
      // 회원 QR — 모바일에서는 회원정보를 열지 않고 안내만 한다(회원정보는 PC 관리자에서 확인)
      csToast.warning('회원정보는 PC 관리자에서 확인 가능합니다.')
      return true
    }
    if (result.type === 'reservation') {
      goto(`/cms/mobile/qr/reservation/${encodeURIComponent(result.value)}`)
      return true
    }
    if (result.type === 'product') {
      goto(`/cms/mobile/qr/${result.value}`)
      return true
    }
    return false
  }
</script>

<div class="mob-page">
  <!-- 카테고리 탭 — 누르면 해당 카테고리의 상품 목록 화면으로 이동 -->
  <div class="cat-tabs" role="tablist" aria-label="상품 카테고리" use:tabScroller={'all'}>
    <button role="tab" type="button" aria-selected="true" class="cat-tab active" onclick={() => goCategory('all')}>전체</button>
    {#each data.categories as cat (cat.value)}
      <button role="tab" type="button" aria-selected="false" class="cat-tab" onclick={() => goCategory(cat.value)}>{cat.label}</button>
    {/each}
  </div>

  <form class="search-wrap" onsubmit={submitSearch}>
    <input
      type="search"
      class="search-input"
      placeholder="상품명·자음·품번 검색 (예: 소니, ㅅㄴ, CAM)"
      bind:value={searchQuery}
      aria-label="상품 검색"
      enterkeyhint="search"
    />
  </form>

  <!-- 대시보드 — 큰 그라데이션 카드(동심원 링 + 단계 목록) + 숫자 카드 2개 -->
  <div class="dash" class:dash--loading={loadingCounts}>
    <button type="button" class="hero-date" onclick={() => (showDatePicker = true)} aria-haspopup="dialog" aria-label={`기준 날짜 ${dateLabel(selectedDate)} — 눌러서 날짜 선택`}>
    {dateLabel(selectedDate)}{#if pickedDate === null}<span class="hero-date-sub">현재까지</span>{/if}
    <ChevronIcon direction="down" size={5} color="#aaaaaa" />
      </button>

    <section class="hero" aria-label="진행 중 대여">
      <div class="hero-top">
        <span class="hero-cap">{activeStage ? activeStage.label : '진행 중 대여'}</span>
        <span class="hero-num" aria-live="polite">{n(activeStage ? activeStage.value : activeTotal)}<small>건</small></span>
      </div>

      <div class="pillars">
        {#each stages as st, i (st.key)}
          <a
            class="pillar pillar--{st.key}"
            class:pillar--on={activeKey === st.key}
            class:pillar--dim={activeKey !== null && activeKey !== st.key}
            href={st.href}
            style:--i={i}
            onpointerdown={() => preview(st.key)}
            onpointerup={release}
            onpointercancel={release}
            onpointerleave={release}
          >
            <span class="pillar-value">{n(st.value)}</span>
            <span class="pillar-track">
              <span class="pillar-fill" style:height="{ready ? pillarH(st.value) : 0}%"></span>
            </span>
            <span class="pillar-label">{st.label}</span>
          </a>
        {/each}
      </div>
    </section>

    <div class="card-row">
      <div class="num-card num-card--warn">
        <span class="num-cap">신청대기</span>
        <span class="num-big">{n(c.hold)}</span>
        {#if c.hold > 0}<span class="pulse" aria-hidden="true"></span>{/if}
      </div>
      <a class="num-card num-card--info" href="/cms/mobile/rentals?status=confirmed">
        <span class="num-cap">{pickedDate === null || pickedDate === data.date ? '오늘 신규' : '당일 신규'}</span>
        <span class="num-big">{n(c.fresh)}</span>
      </a>
    </div>
  </div>
</div>

<!-- 플로팅 아이콘 메뉴 그룹 (상담 채팅 + 대여목록 + 카메라, 하단 우측 고정) -->
<div
  class="fab-group"
  class:peek={fabPeek}
  use:scrollPeek={(v) => (fabPeek = v)}
  role="group"
  aria-label="바로가기"
  onpointerdowncapture={onFabPointerDown}
  onclickcapture={onFabClickCapture}
>
  <MobileChatFab />
  <button
    type="button"
    class="rental-list-fab"
    onclick={() => goto('/cms/mobile/rentals')}
    aria-label="대여 목록"
    title="대여 목록"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="75" height="75" viewBox="0 0 50 50" fill="none" aria-hidden="true">
      <circle cx="25" cy="25" r="25" fill="#3B2F8A"/>
      <g transform="translate(16.5, 13.5)">
        <path d="M5.50195 0.552734V0H11.4268V0.552734C11.4269 0.0478777 11.4273 0.00376604 11.4277 0H11.4521C11.4617 0.000207732 11.4733 0.000442309 11.4854 0.000976562C11.5102 0.0020945 11.5413 0.00449327 11.5762 0.0078125C11.6461 0.0144915 11.7373 0.0265941 11.8418 0.0498047C12.0492 0.0959336 12.3309 0.18971 12.6162 0.379883C13.0867 0.693805 13.4563 1.19576 13.6133 1.9043C14.1644 1.95503 14.5826 2.04988 14.9473 2.23047C15.6296 2.56854 16.1845 3.10811 16.5322 3.77148C16.9275 4.52581 16.9277 5.51345 16.9277 7.48828V16.5166C16.9277 18.4914 16.9275 19.4791 16.5322 20.2334C16.1845 20.8969 15.6297 21.4363 14.9473 21.7744C14.1714 22.1587 13.1553 22.1592 11.124 22.1592H5.80371C3.77246 22.1592 2.75635 22.1588 1.98047 21.7744C1.29818 21.4363 0.743199 20.8968 0.395508 20.2334C0.000285467 19.4791 7.97912e-10 18.4913 0 16.5166V7.48828C1.06551e-08 5.51345 0.000185887 4.52581 0.395508 3.77148C0.743212 3.10806 1.29813 2.56857 1.98047 2.23047C2.34492 2.04993 2.7628 1.95507 3.31348 1.9043C3.47046 1.19536 3.8417 0.693827 4.3125 0.379883C4.59801 0.189565 4.87948 0.095915 5.08691 0.0498047C5.19155 0.0265825 5.28265 0.0144769 5.35254 0.0078125C5.38751 0.00448526 5.41847 0.00208781 5.44336 0.000976562C5.45551 0.000442312 5.46699 0.000207629 5.47656 0H5.50098C5.50145 0.00462108 5.50179 0.0532855 5.50195 0.552734ZM4.83594 15.6426C4.14581 15.6428 3.58602 16.2024 3.58594 16.8926C3.58595 17.5828 4.14576 18.1424 4.83594 18.1426H8.46289C9.15324 18.1426 9.71288 17.5829 9.71289 16.8926C9.7128 16.2023 9.15319 15.6426 8.46289 15.6426H4.83594ZM4.83594 10.752C4.14597 10.7522 3.58628 11.312 3.58594 12.002C3.58594 12.6922 4.14575 13.2518 4.83594 13.252H12.0908C12.781 13.2518 13.3408 12.6922 13.3408 12.002C13.3405 11.312 12.7808 10.7521 12.0908 10.752H4.83594ZM4.83594 5.8623C4.14581 5.86251 3.58602 6.42215 3.58594 7.1123C3.58594 7.80254 4.14575 8.3621 4.83594 8.3623H12.0908C12.781 8.36214 13.3408 7.80256 13.3408 7.1123C13.3407 6.42212 12.781 5.86247 12.0908 5.8623H4.83594Z" fill="white"/>
      </g>
    </svg>
    <FabCountBadge count={mobileNewRentals.count} />
  </button>

  <button
    type="button"
    class="qr-fab"
    onclick={() => (showQrScanner = true)}
    aria-label="QR 코드 스캔"
    title="상품 QR 스캔"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="75" height="75" viewBox="0 0 50 50" fill="none" aria-hidden="true">
      <circle cx="25" cy="25" r="25" fill="#3B2F8A"/>
      <g transform="translate(14.6, 17)">
        <path d="M16.8008 0C19.0097 0.000212977 20.8008 1.79099 20.8008 4V12C20.8008 14.209 19.0097 15.9998 16.8008 16H4C1.79104 15.9998 0 14.209 0 12V4C0 1.79099 1.79104 0.000211051 4 0H16.8008ZM10.4004 4C8.19137 4 6.40059 5.79103 6.40039 8C6.4006 10.209 8.19138 12 10.4004 12C12.6094 12 14.4002 10.209 14.4004 8C14.4002 5.79103 12.6094 4 10.4004 4ZM16.8008 2.40039C15.9172 2.40039 15.2004 3.11651 15.2002 4C15.2004 4.88348 15.9173 5.60059 16.8008 5.60059C17.6841 5.60038 18.4002 4.88335 18.4004 4C18.4002 3.11664 17.6841 2.4006 16.8008 2.40039Z" fill="white"/>
      </g>
    </svg>
  </button>
</div>

<MobileDatePickerModal open={showDatePicker} value={pickedDate ?? ''} onselect={pickDate} onclose={() => (showDatePicker = false)} onreset={pickedDate !== null ? resetDate : undefined} resetLabel="현재까지 전체 보기" />

<QrScannerOverlay
  bind:open={showQrScanner}
  onDetected={handleQrDetected}
  onClose={() => (showQrScanner = false)}
/>

<style>
  .mob-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--cs-lilac);
  }

  /* 카테고리 탭 */
  .cat-tabs {
    display: flex;
    gap: 9px; /* 버튼 간격 6→9px(+50%) */
    padding: 0 14px;
    margin-top: 30px; /* GNB와의 간격은 이 블록의 바깥 여백(블록 높이는 버튼 높이 그대로) */
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .cat-tabs::-webkit-scrollbar { display: none; }
  /* 가로 스크롤 인터랙션 — 탭이 눈에 맞게 멈추고(snap), 더 볼 내용이 있는 쪽 가장자리는 흐려진다 */
  .cat-tabs { scroll-snap-type: x proximity; scroll-padding: 0 14px; overscroll-behavior-x: contain; cursor: grab; }
  .cat-tabs:global(.has-left.has-right) { -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%); mask-image: linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%); }
  .cat-tabs:global(.has-left:not(.has-right)) { -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 28px); mask-image: linear-gradient(90deg, transparent 0, #000 28px); }
  .cat-tabs:global(.has-right:not(.has-left)) { -webkit-mask-image: linear-gradient(270deg, transparent 0, #000 28px); mask-image: linear-gradient(270deg, transparent 0, #000 28px); }
  /* 스크롤 속도에 따라 버튼이 살짝 기울었다가(--tab-skew, tabScroller가 설정) 스프링으로 돌아온다 */
  /* 양끝 고무줄 — 끝에서 더 끌면 버튼이 저항을 받으며 따라 늘어났다가, 놓으면 용수철로 튕겨 돌아온다(--tab-pull, tabScroller가 설정) */
  .cat-tabs { overscroll-behavior-x: none; }
  .cat-tab { translate: calc(var(--tab-pull, 0) * 1px) 0; transition: transform 0.45s cubic-bezier(0.22, 1.5, 0.36, 1), background 0.12s, color 0.12s; }
  .cat-tabs:global(.tabs-release) .cat-tab { transition: translate 0.85s cubic-bezier(0.22, 1.6, 0.36, 1), background 0.12s, color 0.12s, transform 0.45s cubic-bezier(0.22, 1.5, 0.36, 1); }
  .cat-tab { scroll-snap-align: center; transform: skewX(calc(var(--tab-skew, 0) * 1deg)); }
  .cat-tab:active { transform: skewX(calc(var(--tab-skew, 0) * 1deg)) scale(0.92); }
  @media (prefers-reduced-motion: reduce) { .cat-tab { transform: none; } }

  .cat-tab {
    flex-shrink: 0;
    padding: 7px 14px;
    border: none;
    border-radius: var(--radius-xl);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    min-height: 34px;
    white-space: nowrap;
    transition: background 0.12s, color 0.12s, transform 0.45s cubic-bezier(0.22, 1.5, 0.36, 1);
  }
  .cat-tab.active { background: var(--cs-purple); color: var(--cs-white); }

  .search-wrap {
    padding: 0 14px;
    margin-top: 12px; /* 카테고리 줄과의 간격은 이 블록의 바깥 여백 */
    background: var(--cs-lilac);
  }
  .search-input {
    width: 100%;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    padding: 15px 16px;
    font-size: 15px;
    color: var(--cs-text);
    height: 50px;
  }
  .search-input::placeholder { color: var(--cs-text-placeholder); }
  .search-input:focus { outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }

  /* 대시보드 */
  .dash {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 14px 20px;
    margin-top: 36px; /* 검색창과의 간격은 이 블록의 바깥 여백 */
  }

  /* 큰 카드 — 보라 그라데이션 면 + 빛 번짐 + 천천히 흐르는 빛줄기 */
  .hero {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px 20px 18px;
    border-radius: var(--cms-radius-lg);
    background: linear-gradient(140deg, var(--cs-purple-light) 0%, var(--cs-purple) 55%, var(--cs-purple-dark) 100%);
    color: var(--cs-white);
    overflow: hidden;
  }
  .hero::before {
    content: '';
    position: absolute;
    top: -70px;
    right: -50px;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0) 70%);
    pointer-events: none;
    animation: hero-glow 5s ease-in-out infinite;
  }
  .hero::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, 0.10) 50%, transparent 65%);
    transform: translateX(-120%);
    animation: hero-sheen 6s ease-in-out 1.2s infinite;
    pointer-events: none;
  }
  @keyframes hero-glow { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.18); opacity: 0.55; } }
  @keyframes hero-sheen { 0% { transform: translateX(-120%); } 40%, 100% { transform: translateX(120%); } }

  /* 카드 위(상위) 가운데 날짜 — 누르면 달력 모달 */
  .hero-date {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 18px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent; /* 배경 없음 — 글자와 화살표만 */
    color: var(--cs-text);
    font: var(--text-m-body-16B); /* 14px → 16px 한 단계 확대 */
    font-family: var(--font-en-d-din), var(--font-kr);
    cursor: pointer;
    transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.15s;
  }
  .hero-date:active { transform: scale(0.95); }
  .hero-date-sub { font: var(--text-m-script-12); font-family: var(--font-kr); color: var(--cs-text-mid); }
  .dash--loading { opacity: 0.6; transition: opacity 0.15s; }
  .hero-top { display: flex; align-items: flex-end; justify-content: space-between; position: relative; z-index: 1; }
  .hero-cap { font: var(--text-m-script-14B); color: rgba(255, 255, 255, 0.78); padding-bottom: 4px; }
  .hero-num { font: 700 48px/1 var(--font-en-d-din); letter-spacing: -1px; }
  .hero-num small { font: 700 14px/1 var(--font-kr); margin-left: 4px; color: rgba(255, 255, 255, 0.7); letter-spacing: 0; }

  /* 막대(필러) 4개 — 바닥 정렬, 용수철처럼 튕기며 솟아오름 */
  .pillars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; position: relative; z-index: 1; }
  .pillar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--cs-white);
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s;
  }
  .pillar-value { font: 700 20px/1 var(--font-en-d-din); }
  .pillar-track {
    display: flex;
    align-items: flex-end;
    width: 100%;
    height: 104px;
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .pillar-fill {
    width: 100%;
    border-radius: var(--radius-lg);
    background: var(--pc, var(--cs-purple-pale));
    transition: height 1s cubic-bezier(0.34, 1.56, 0.64, 1) calc(var(--i) * 110ms), box-shadow 0.2s;
  }
  .pillar--confirmed { --pc: var(--cs-purple-pale); }
  .pillar--shipped { --pc: var(--cs-info); }
  .pillar--inuse { --pc: var(--cs-white); }
  .pillar--returning { --pc: var(--cs-red-badge); }
  .pillar-label { font: var(--text-m-script-12); color: rgba(255, 255, 255, 0.82); white-space: nowrap; }
  /* 누르고 있는 막대는 위로 떠오르며 빛나고, 나머지는 물러난다 */
  .pillar--on { transform: translateY(-6px) scale(1.04); }
  .pillar--on .pillar-fill { box-shadow: 0 0 22px var(--pc); }
  .pillar--dim { opacity: 0.4; transform: scale(0.97); }

  /* 숫자 카드 2개 — 정사각 라운드형: 위 캡션, 아래 큰 숫자, 옅은 색 면 */
  .card-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .num-card {
    position: relative;
    aspect-ratio: 1 / 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 20px;
    border-radius: var(--cms-radius-lg);
    text-decoration: none;
    color: var(--cs-text);
    overflow: hidden;
    transition: transform 0.15s;
  }
  .num-card--warn { background: color-mix(in srgb, var(--cs-warning) 16%, var(--cs-white)); }
  .num-card--info { background: color-mix(in srgb, var(--cs-info) 18%, var(--cs-white)); } /* 배경(라일락)과 구분되도록 파랑 계열 면 */
  /* 모서리에 번지는 큰 원 장식 — 같은 색의 옅은 면 */
  .num-card::after {
    content: '';
    position: absolute;
    right: -34px;
    bottom: -34px;
    width: 110px;
    height: 110px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.55);
    pointer-events: none;
  }
  a.num-card:active { transform: scale(0.96); }
  .num-cap { font: var(--text-m-script-14B); color: var(--cs-text-mid); }
  /* 큰 숫자는 카드 정중앙(가로·세로) */
  .num-big {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 700 56px/1 var(--font-en-d-din);
    letter-spacing: -1px;
  }
  .num-cap { position: relative; z-index: 1; }
  .num-card--warn .num-big { color: var(--cs-warning); }
  .num-card--info .num-big { color: var(--cs-info); }
  /* 신청대기가 있을 때 숨 쉬는 점 */
  .pulse {
    position: absolute;
    top: 18px;
    right: 18px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cs-warning);
    animation: dash-pulse 1.6s ease-in-out infinite;
  }
  @keyframes dash-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.7); opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse { animation: none; }
    .ring-arc, .hero-row { transition: none; }
  }

  /* ── 플로팅 아이콘 메뉴 그룹 — 아이콘 30% 축소(75→52.5px), 감쇠 스프링 값 재계산 ── */
  .fab-group {
    position: fixed;
    bottom: 24px;
    right: 20px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 11.2px;
    transform: translateX(0);
  }
  .fab-group:not(.peek) {
    animation: fab-pop-out 0.5s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
  }
  .fab-group.peek {
    animation: fab-peek-in 0.22s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
  }
  @keyframes fab-pop-out {
    0%   { transform: translateX(calc(50% + 20px)); }
    28%  { transform: translateX(-16.8px); }
    46%  { transform: translateX(8px); }
    61%  { transform: translateX(-4px); }
    73%  { transform: translateX(2px); }
    83%  { transform: translateX(-1px); }
    91%  { transform: translateX(0.5px); }
    100% { transform: translateX(0); }
  }
  @keyframes fab-peek-in {
    0%   { transform: translateX(0); }
    55%  { transform: translateX(52px); }
    78%  { transform: translateX(42.4px); }
    92%  { transform: translateX(46.8px); }
    100% { transform: translateX(calc(50% + 20px)); }
  }

  .qr-fab,
  .rental-list-fab {
    position: relative;
    width: 52.5px;
    height: 52.5px;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
  }
  .qr-fab svg, .rental-list-fab svg { width: 100%; height: 100%; }
  .qr-fab:active, .rental-list-fab:active { transform: scale(0.96); }
  @media (hover: hover) {
    .qr-fab:hover, .rental-list-fab:hover { transform: scale(1.06); }
  }
</style>
