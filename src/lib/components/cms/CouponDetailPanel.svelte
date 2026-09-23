<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import type { Coupon } from '$lib/types/database'

  interface Props {
    coupon:  Coupon
    onclose: () => void
    // 어느 목록 탭에서 이 패널을 열었는지 — Stephen 확정(2026-08-18): 발행관리(manage)와
    // 사용량리포트(report)에서 동일한 '배포' 탭을 중복 노출하는 게 불필요하다고 판단,
    // manage에서는 기존 배포 실행 폼을 그대로 유지하고, report에서는 그 자리를
    // '사용 채번 목록'으로 완전히 대체한다(조건부 3번째 탭 추가 방식은 반려됨).
    context: 'manage' | 'report'
    // 2026-09-21 추가: "적용 카테고리" 편집용 선택지(coupon.type==='category'일 때만 노출)
    categoryOptions?: { value: string; label: string }[]
    // 2026-09-23 추가: "필수 회원 분류"(일반/학생/구독) 선택지 — CustomerDetailPanel의
    // classificationsOf()와 동일 기준(BASIC/PRO 하드코딩 결함 수정, Migration #528 참고)
    gradeOptions?: { value: string; label: string }[]
  }
  let { coupon, onclose, context, categoryOptions = [], gradeOptions = [] }: Props = $props()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cc = coupon as any

  // 2026-09-23 — coupon/new/+page.svelte의 USER_GRADE_OPTIONS와 동일 패턴(SuggestPicker
  // 옵션 형식으로 gradeOptions prop을 변환)
  const USER_GRADE_OPTIONS: SuggestPickerOption[] = [
    { id: '__all__', label: '전체 회원' },
    ...gradeOptions.map(g => ({ id: g.value, label: g.label })),
  ]

  // report 컨텍스트는 '정보'도 발행관리 탭 패널과 중복이라 판단(Stephen 확정,
  // 2026-08-18) — 탭 자체를 없애고 '사용 채번 목록' 단독 뷰만 보여준다.
  let activeTab = $state<'info' | 'distribute' | 'redemptions'>(context === 'report' ? 'redemptions' : 'info')

  // ─ 사용 채번 목록 (report 컨텍스트 전용, 지연 로드) ─
  // 랜딩 대상은 RentalDetailPanel(/cms/reservation 또는 /cms/rentals, migration 301) —
  // "이 쿠폰이 결제된 정확한 예약"이 아니라 그 사용자의 가장 최근 예약(대여 정보 확인
  // 목적). 서버가 user_id 기준으로 조회하므로 같은 사용자가 쿠폰을 중복 사용해도 항상
  // 정확히 그 사용자로 연결된다. 예약이 하나도 없으면 cmsPath/reservationId가 null.
  interface RedemptionRow {
    userCouponId:  string
    userId:        string
    redeemedCode:  string | null
    usedAt:        string
    userName:      string | null
    userEmail:     string | null
    reservationId: number | null
    cmsPath:       string | null
  }
  let redemptions        = $state<RedemptionRow[]>([])
  let redemptionsLoaded  = $state(false)
  let redemptionsLoading = $state(false)

  async function loadRedemptions() {
    if (redemptionsLoaded || redemptionsLoading) return
    redemptionsLoading = true
    try {
      const res = await fetch(`/api/cms/coupons/${coupon.id}/redemptions`)
      if (res.ok) {
        const body = await res.json()
        redemptions = (body.redemptions ?? []) as RedemptionRow[]
      }
    } finally {
      redemptionsLoading = false
      redemptionsLoaded = true
    }
  }

  function selectTab(tab: typeof activeTab) {
    activeTab = tab
    // 2026-09-23(Stephen 지시) — manage 컨텍스트의 "배포" 탭에도 사용된 코드품번 목록을
    // 함께 보여주므로(아래 snippet redemptionsList 참고), 그 탭을 열 때도 함께 로드.
    if (tab === 'redemptions' || tab === 'distribute') loadRedemptions()
  }

  // report 컨텍스트는 탭 버튼(클릭)이 없으므로 마운트 시 바로 로드
  $effect(() => {
    if (context === 'report') loadRedemptions()
  })

  function formatDateTime(iso: string): string {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // ─ 핵심 정보 수정 ─
  // 2026-09-21 수정: "전체 발급 한도"는 쿠폰 생성화면(/cms/promotion/coupon/new)에서부터
  // 줄곧 total_usage_limit 컬럼에 저장돼 왔는데, 이 수정 폼만 잘못된 컬럼(usage_limit)을
  // 편집·표시하고 있었다 — 그 결과 관리자가 만든 발급 한도가 화면에 전혀 반영되지 않고
  // 항상 "0 / ∞"로 보이던 결함이었다. usage_limit 컬럼 자체는 다른 목적(장바구니 자격조건
  // 검증)으로 여전히 쓰이므로 건드리지 않고, 이 폼의 바인딩만 total_usage_limit으로 교정.
  let u_discount_type   = $state<string>(coupon.discount_type)
  let u_discount_value  = $state(coupon.discount_value)
  let u_max_discount    = $state(cc.max_discount_amount ?? 0)
  let u_total_usage_limit = $state(cc.total_usage_limit ?? 0)
  let u_display_name    = $state(cc.display_name ?? '')
  let u_user_grade      = $state(cc.user_grade_required ?? '')
  // 2026-09-23 추가 — "필수 회원 분류" 필드를 SuggestPicker로 전환(Stephen 지시, coupon/new
  // 생성 화면과 동일 스타일 통일). SuggestPicker 내부 표현('__all__')과 실제 저장값('')이
  // 달라 별도 브리지 상태로 분리 — onselect에서 u_user_grade로 역매핑됨.
  let _sel_grade = $state<string | null>(cc.user_grade_required ? cc.user_grade_required : '__all__')
  let u_validity_type   = $state<'fixed_period' | 'unlimited' | 'relative_days'>(cc.validity_type ?? 'fixed_period')
  let u_valid_from      = $state(coupon.valid_from ? coupon.valid_from.substring(0, 10) : '')
  let u_valid_until     = $state(coupon.valid_until ? coupon.valid_until.substring(0, 10) : '')
  let u_valid_days      = $state<number | null>(cc.valid_days ?? null)
  let updateLoading     = $state(false)

  // 2026-09-21 추가 — 생성화면(/cms/promotion/coupon/new)에는 있으나 이 수정 패널에는 없어
  // 발행 후 확인·변경이 불가능했던 필드들("4번 지적사항" 구현)
  let u_description          = $state(cc.description ?? '')
  let u_min_purchase_amount  = $state(cc.min_purchase_amount ?? 0)
  let u_min_rental_amount    = $state(cc.min_rental_amount ?? 0)
  let u_min_rental_days      = $state(cc.min_rental_days ?? 0)
  let u_per_user_limit       = $state(cc.per_user_limit ?? 1)
  let u_categories           = $state<string[]>(cc.applicable_categories ?? [])
  let u_first_rental         = $state(cc.is_first_rental_only === true)
  let u_student              = $state(cc.is_student_only === true)
  let u_walk_in              = $state(cc.is_walk_in_only === true)
  let u_subscription         = $state(cc.is_subscription_only === true)
  let u_allow_points         = $state(cc.allow_with_points !== false)
  let u_allow_stacking       = $state(cc.allow_stacking === true)

  function toggleCat(c: string) {
    u_categories = u_categories.includes(c)
      ? u_categories.filter((x) => x !== c)
      : [...u_categories, c]
  }

  // coupon prop 변경 시(invalidateAll 후) 편집 필드 재동기화 — ProductDetailPanel $effect 패턴 동일
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ccEff = coupon as any
    u_discount_type  = coupon.discount_type
    u_discount_value = coupon.discount_value
    u_max_discount   = ccEff.max_discount_amount ?? 0
    u_total_usage_limit = ccEff.total_usage_limit ?? 0
    u_display_name   = ccEff.display_name ?? ''
    u_user_grade     = ccEff.user_grade_required ?? ''
    _sel_grade       = ccEff.user_grade_required ? ccEff.user_grade_required : '__all__'
    u_validity_type  = ccEff.validity_type ?? 'fixed_period'
    u_valid_from     = coupon.valid_from  ? coupon.valid_from.substring(0, 10)  : ''
    u_valid_until    = coupon.valid_until ? coupon.valid_until.substring(0, 10) : ''
    u_valid_days     = ccEff.valid_days ?? null
    u_description         = ccEff.description ?? ''
    u_min_purchase_amount = ccEff.min_purchase_amount ?? 0
    u_min_rental_amount   = ccEff.min_rental_amount ?? 0
    u_min_rental_days     = ccEff.min_rental_days ?? 0
    u_per_user_limit      = ccEff.per_user_limit ?? 1
    u_categories          = ccEff.applicable_categories ?? []
    u_first_rental        = ccEff.is_first_rental_only === true
    u_student             = ccEff.is_student_only === true
    u_walk_in             = ccEff.is_walk_in_only === true
    u_subscription        = ccEff.is_subscription_only === true
    u_allow_points        = ccEff.allow_with_points !== false
    u_allow_stacking      = ccEff.allow_stacking === true
  })

  // 2026-09-23 추가(Stephen 지시) — "정보 저장" 버튼을 변경사항 유무에 따라 활성/비활성
  // 전환(products.md §4 isDirty 패턴과 동일 원리). u_* 전부를 coupon prop 원본값과 비교.
  const origInfo = $derived({
    discountType: coupon.discount_type,
    discountValue: coupon.discount_value,
    maxDiscount: cc.max_discount_amount ?? 0,
    totalUsageLimit: cc.total_usage_limit ?? 0,
    displayName: cc.display_name ?? '',
    userGrade: cc.user_grade_required ?? '',
    validityType: cc.validity_type ?? 'fixed_period',
    validFrom: coupon.valid_from ? coupon.valid_from.substring(0, 10) : '',
    validUntil: coupon.valid_until ? coupon.valid_until.substring(0, 10) : '',
    validDays: cc.valid_days ?? null,
    description: cc.description ?? '',
    minPurchaseAmount: cc.min_purchase_amount ?? 0,
    minRentalAmount: cc.min_rental_amount ?? 0,
    minRentalDays: cc.min_rental_days ?? 0,
    perUserLimit: cc.per_user_limit ?? 1,
    categories: JSON.stringify([...(cc.applicable_categories ?? [])].sort()),
    firstRental: cc.is_first_rental_only === true,
    student: cc.is_student_only === true,
    walkIn: cc.is_walk_in_only === true,
    subscription: cc.is_subscription_only === true,
    allowPoints: cc.allow_with_points !== false,
    allowStacking: cc.allow_stacking === true,
  })
  const isDirtyInfo = $derived(
    u_discount_type !== origInfo.discountType ||
    u_discount_value !== origInfo.discountValue ||
    u_max_discount !== origInfo.maxDiscount ||
    u_total_usage_limit !== origInfo.totalUsageLimit ||
    u_display_name !== origInfo.displayName ||
    u_user_grade !== origInfo.userGrade ||
    u_validity_type !== origInfo.validityType ||
    u_valid_from !== origInfo.validFrom ||
    u_valid_until !== origInfo.validUntil ||
    u_valid_days !== origInfo.validDays ||
    u_description !== origInfo.description ||
    u_min_purchase_amount !== origInfo.minPurchaseAmount ||
    u_min_rental_amount !== origInfo.minRentalAmount ||
    u_min_rental_days !== origInfo.minRentalDays ||
    u_per_user_limit !== origInfo.perUserLimit ||
    JSON.stringify([...u_categories].sort()) !== origInfo.categories ||
    u_first_rental !== origInfo.firstRental ||
    u_student !== origInfo.student ||
    u_walk_in !== origInfo.walkIn ||
    u_subscription !== origInfo.subscription ||
    u_allow_points !== origInfo.allowPoints ||
    u_allow_stacking !== origInfo.allowStacking
  )

  // ─ 특정 사용자 수동 지급(2026-09-23 재설계) ─
  // 기존 "배포 대상"(전체회원/특정등급/특정사용자UUID) 3분기 중 전체회원·특정등급은
  // 아래 "자동배포"(coupons.auto_distribute_enabled + 필수 회원 등급) 엔진과 완전히
  // 중복되는 기능이라 Stephen 지시로 제거 — "정보" 탭의 "필수 회원 등급(선택)"이 유일한
  // 기준이 된다. 특정 사용자 UUID/이메일 수동 지급만 별도 용도(채팅과 무관하게 관리자가
  // 특정 고객 1명에게만 예외적으로 지급)로 존속.
  let distUuids    = $state('')
  let distLoading  = $state(false)

  let distTargetMeta = $derived(
    distUuids.trim()
      ? JSON.stringify({ user_ids: distUuids.split('\n').map((s: string) => s.trim()).filter(Boolean) })
      : null
  )

  function typeLabel(type: string): string {
    const MAP: Record<string, string> = {
      fixed: '정액', percent: '정률', free_delivery: '무료배송',
      first_rental: '첫렌탈', category: '카테고리', bundle: '번들',
      subscription: '구독전용', student: '학생전용', walk_in: '방문픽업',
      reactivation: '휴면복귀', referral: '추천인', event: '이벤트', all: '전체',
    }
    return MAP[type] ?? type
  }

  // +page.svelte codeDisplay()와 동일 규칙 — sequenced 모드는 code가 NULL이므로
  // code_series 패턴 프리뷰로 대체 표시(목록·헤더 표기 일관성)
  function codeDisplay(c: { code: string | null; code_mode?: string; code_series?: { prefix?: string; category_code?: string } | null }): string {
    if (c.code) return c.code
    if (c.code_mode === 'sequenced' && c.code_series) {
      const prefix = c.code_series.prefix ?? 'CS'
      const cat = c.code_series.category_code ?? ''
      return `${prefix}${cat}*`
    }
    return '—'
  }
</script>

<div class="panel">
  <!-- 패널 헤더 -->
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-label">쿠폰</span>
      <span class="panel-id">{codeDisplay(coupon)}</span>
      {#if cc.display_name}
        <span class="panel-name">{cc.display_name}</span>
      {/if}
      <span class="panel-status">{typeLabel(coupon.type)}</span>
    </div>
    <button class="close-btn" onclick={onclose} aria-label="패널 닫기">✕</button>
  </div>

  <!-- 탭 — manage 컨텍스트에서만 노출(정보+배포, 기존 그대로). report 컨텍스트는 '정보'도
       발행관리 패널과 중복이라 판단해 탭 자체를 없애고 '사용 채번 목록' 단독 뷰만 표시
       (Stephen 확정, 2026-08-18). -->
  {#if context === 'manage'}
    <div class="panel-tabs" role="tablist">
      {#each [{ id: 'info', label: '정보' }, { id: 'distribute', label: '배포' }] as tab}
        <button
          class="tab"
          class:tab-active={activeTab === tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          onclick={() => selectTab(tab.id as typeof activeTab)}
        >{tab.label}</button>
      {/each}
    </div>
  {/if}

  <!-- 탭 바디 -->
  <div class="panel-body">

    <!-- 사용 채번 목록(2026-09-23 — manage 컨텍스트 "배포" 탭 + report 컨텍스트 단독 탭
         양쪽에서 공유하는 snippet, 위 각 분기 참고) -->
    {#snippet redemptionsList()}
      <div class="section-title">사용 채번 목록</div>
      {#if redemptionsLoading}
        <p class="hint">불러오는 중...</p>
      {:else if redemptions.length === 0}
        <p class="hint">아직 사용된 내역이 없습니다.</p>
      {:else}
        <div class="redemption-list">
          {#each redemptions as r (r.userCouponId)}
            <!-- sequenced 모드는 개별 채번된 redeemedCode, manual 모드는 redeemedCode가
                 없으므로(사용자별로 다른 코드가 생기지 않음) 쿠폰 고유 code로 대체 표시.
                 랜딩은 RentalDetailPanel — "이 쿠폰이 결제된 정확한 예약"이 아니라 그
                 사용자의 가장 최근 예약(대여 정보 확인 목적, migration 301). 서버가
                 user_id 기준으로 대표 예약을 고르므로 중복 쿠폰 사용에도 항상 정확히
                 그 사용자로 연결됨 — 단, 그 사용자에게 예약이 하나도 없으면 비활성. -->
            {#if r.cmsPath && r.reservationId}
              <a
                class="redemption-row redemption-row--linked"
                href="{r.cmsPath}?selected={r.reservationId}"
                target="_blank"
                rel="noopener"
                title="대여 정보 열기"
              >
                <span class="redemption-code">{r.redeemedCode ?? coupon.code ?? '—'}</span>
                <span class="redemption-meta">{formatDateTime(r.usedAt)}</span>
                <span class="redemption-user">{r.userName ?? '이름 미등록'} ({r.userEmail ?? '이메일 없음'})</span>
              </a>
            {:else}
              <div class="redemption-row" title="이 사용자의 대여 정보를 찾을 수 없습니다">
                <span class="redemption-code">{r.redeemedCode ?? coupon.code ?? '—'}</span>
                <span class="redemption-meta">{formatDateTime(r.usedAt)}</span>
                <span class="redemption-user">{r.userName ?? '이름 미등록'} ({r.userEmail ?? '이메일 없음'})</span>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    {/snippet}

    <!-- ─── 탭1: 정보 ─── -->
    {#if activeTab === 'info'}
      <div class="section-title">현황</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">사용/한도</span>
          <span class="info-value">{coupon.usage_count} / {cc.total_usage_limit ?? '∞'}</span>
        </div>
        <!-- 자동배포 토글(Migration #527, 구 distribution_enabled → auto_distribute_enabled
             재설계) — 켜두면 "정보" 탭의 "필수 회원 등급" 조건을 충족하는 회원에게 계속
             감시하며 자동으로 배포된다(pg_cron, auto_distribute_eligible_coupons RPC).
             끄면 자동배포만 멈춘다 — 이미 배포받은 고객의 열람·사용, "특정 사용자 수동
             지급"(배포 탭)에는 영향 없음(완전히 별개 경로). 2026-09-23(Stephen 지시) —
             "상태" 행 하나로 토글 통합. -->
        <div class="info-row">
          <span class="info-label">상태</span>
          <span class="info-value">
            <form method="POST" action="?/toggleAutoDistribute" use:enhance class="status-tog-row">
              <input type="hidden" name="id" value={coupon.id} />
              <button type="submit" class="tog" class:tog-on={coupon.auto_distribute_enabled}
                role="switch" aria-checked={coupon.auto_distribute_enabled} aria-label="자동배포 토글">
                <span class="tog-thumb"></span>
              </button>
              <span class="tog-status-label">{coupon.auto_distribute_enabled ? '자동배포 활성' : '자동배포 중지'}</span>
            </form>
          </span>
        </div>
      </div>

      <div class="section-header section-header-solo">
        <button form="form-coupon-info" type="submit" class="btn-save-inline"
          class:dirty={isDirtyInfo} disabled={updateLoading || !isDirtyInfo}
        >{updateLoading ? '저장 중...' : '저장'}</button>
      </div>
      <form id="form-coupon-info" method="POST" action="?/updateCoupon"
        use:enhance={({ cancel }) => {
          if (!u_discount_value || u_discount_value <= 0) {
            csToast.error('할인값을 입력해주세요.')
            cancel()
            return
          }
          updateLoading = true
          return async ({ result, update }) => {
            updateLoading = false
            if (result.type === 'success') csToast.success('저장되었습니다.')
            await update()
          }
        }}
      >
        <input type="hidden" name="id" value={coupon.id} />
        <div class="validity-group validity-group-attached">
         <div class="section-title">핵심 정보 수정</div>
         <div class="form-grid">
          <div class="form-field">
            <label for="uc-dname">쿠폰 이름 (고객 노출)</label>
            <input id="uc-dname" name="display_name" type="text"
              class="f-input" bind:value={u_display_name} placeholder="고객 화면에 표시될 이름" />
          </div>
          <div class="form-field">
            <label for="uc-dtype">할인 방식</label>
            <select id="uc-dtype" name="discount_type" class="f-input" bind:value={u_discount_type}>
              <option value="fixed">정액 (원)</option>
              <option value="percentage">정률 (%)</option>
              <option value="free_shipping">무료배송</option>
            </select>
          </div>
          <div class="form-field">
            <label for="uc-dval">할인값</label>
            <input id="uc-dval" name="discount_value" type="number" min="0"
              class="f-input" bind:value={u_discount_value} />
          </div>
          {#if u_discount_type === 'percentage'}
            <div class="form-field">
              <label for="uc-maxd">최대 할인 한도 (원, 0=무제한)</label>
              <input id="uc-maxd" name="max_discount_amount" type="number" min="0"
                class="f-input" bind:value={u_max_discount} />
            </div>
          {/if}
          <div class="form-field">
            <label for="uc-tul">전체 발급 한도 (0=무제한)</label>
            <input id="uc-tul" name="total_usage_limit" type="number" min="0"
              class="f-input" bind:value={u_total_usage_limit} />
          </div>
          <div class="form-field">
            <!-- 2026-09-23(버그 수정, Stephen 지적) — "등급"이라는 표현 자체가 이 서비스
                 정책과 맞지 않는다(회원 등급 체계 없음). 실제로 이 값과 대응되는 건
                 CustomerDetailPanel classificationsOf()의 "일반/학생/구독" 3종뿐이라
                 라벨을 교정. 2026-09-23(같은 날 후속, Stephen 지시) — coupon/new 생성
                 화면과 스타일을 통일하기 위해 plain select → SuggestPicker로 전환. -->
            <label for="uc-grade">필수 회원 분류 (선택)</label>
            <SuggestPicker
              id="uc-grade"
              bind:selectedId={_sel_grade}
              options={USER_GRADE_OPTIONS}
              placeholder="회원 분류 선택"
              listLabel="회원 분류"
              variant="generic"
              minChars={0}
              onselect={(opt) => { u_user_grade = opt.id === '__all__' ? '' : opt.id }}
            >
              {#snippet field(c)}
                <input type="text" class="f-input" id={c.id} placeholder={c.placeholder}
                  value={c.value} oninput={c.oninput} onkeydown={c.onkeydown}
                  onfocus={c.onfocus} onblur={c.onblur}
                  aria-autocomplete={c.ariaAutocomplete} aria-expanded={c.ariaExpanded}
                  aria-controls={c.ariaControls} autocomplete="off" />
              {/snippet}
            </SuggestPicker>
            <input type="hidden" name="user_grade_required" value={u_user_grade} />
          </div>
         </div>
        </div>
        <div class="validity-group">
          <div class="radio-group">
            <label class="radio-lbl">
              <input type="radio" name="validity_type" value="fixed_period" bind:group={u_validity_type} />
              제한 기간
            </label>
            <label class="radio-lbl">
              <input type="radio" name="validity_type" value="unlimited" bind:group={u_validity_type} />
              무제한
            </label>
            <label class="radio-lbl">
              <input type="radio" name="validity_type" value="relative_days" bind:group={u_validity_type} />
              첫 확인일로부터 N일
            </label>
          </div>
          {#if u_validity_type === 'fixed_period'}
            <div class="form-grid">
              <div class="form-field">
                <label for="uc-vf">시작일</label>
                <CmsDatePicker bind:value={u_valid_from} name="valid_from" placeholder="시작일 선택" disablePast={false} />
              </div>
              <div class="form-field">
                <label for="uc-vu">종료일</label>
                <CmsDatePicker bind:value={u_valid_until} name="valid_until" placeholder="종료일 선택" disablePast={false} />
              </div>
            </div>
          {/if}
          {#if u_validity_type === 'relative_days'}
            <div class="form-field" style="max-width:200px">
              <label for="uc-vd">유효일수 (N일)</label>
              <input id="uc-vd" type="number" name="valid_days" min="1" class="f-input"
                bind:value={u_valid_days} placeholder="예: 7" />
            </div>
          {/if}
        </div>

        <div class="validity-group">
         <div class="section-title">사용 조건</div>
         <div class="form-grid">
          <div class="form-field">
            <label for="uc-mpa">최소 구매금액 (원, 0=없음)</label>
            <input id="uc-mpa" name="min_purchase_amount" type="number" min="0"
              class="f-input" bind:value={u_min_purchase_amount} />
          </div>
          <div class="form-field">
            <label for="uc-mra">최소 대여금액 (원, 0=없음)</label>
            <input id="uc-mra" name="min_rental_amount" type="number" min="0"
              class="f-input" bind:value={u_min_rental_amount} />
          </div>
          <div class="form-field">
            <label for="uc-mrd">최소 대여기간 (일, 0=없음)</label>
            <input id="uc-mrd" name="min_rental_days" type="number" min="0"
              class="f-input" bind:value={u_min_rental_days} />
          </div>
          <div class="form-field">
            <label for="uc-pul">1인당 사용 횟수</label>
            <input id="uc-pul" name="per_user_limit" type="number" min="1"
              class="f-input" bind:value={u_per_user_limit} />
          </div>
         </div>
        </div>

        {#if cc.type === 'category'}
          <div class="section-title">적용 카테고리</div>
          <div class="cat-picker">
            {#each categoryOptions as cat (cat.value)}
              <button type="button" class="cat-chip" class:selected={u_categories.includes(cat.value)}
                onclick={() => toggleCat(cat.value)}>{cat.label}</button>
            {/each}
          </div>
          <input type="hidden" name="applicable_categories"
            value={u_categories.length ? JSON.stringify(u_categories) : ''} />
        {/if}

        <div class="validity-group">
         <div class="section-title">전용 조건</div>
         <div class="s-chip-group">
          <button type="button" class="s-chip" class:s-chip--on={u_first_rental}
            onclick={() => u_first_rental = !u_first_rental}>첫 렌탈 전용</button>
          <button type="button" class="s-chip" class:s-chip--on={u_student}
            onclick={() => u_student = !u_student}>학생 인증 계정 전용</button>
          <button type="button" class="s-chip" class:s-chip--on={u_walk_in}
            onclick={() => u_walk_in = !u_walk_in}>방문 픽업 전용</button>
          <button type="button" class="s-chip" class:s-chip--on={u_subscription}
            onclick={() => u_subscription = !u_subscription}>정기구독 전용</button>
         </div>
         <input type="hidden" name="is_first_rental_only" value={String(u_first_rental)} />
         <input type="hidden" name="is_student_only" value={String(u_student)} />
         <input type="hidden" name="is_walk_in_only" value={String(u_walk_in)} />
         <input type="hidden" name="is_subscription_only" value={String(u_subscription)} />
        </div>

        <div class="validity-group">
         <div class="section-title">결합 옵션</div>
         <div class="s-chip-group">
          <button type="button" class="s-chip" class:s-chip--on={u_allow_points}
            onclick={() => u_allow_points = !u_allow_points}>포인트 결합 사용 허용</button>
          <button type="button" class="s-chip" class:s-chip--on={u_allow_stacking}
            onclick={() => u_allow_stacking = !u_allow_stacking}>쿠폰 중복 사용 허용</button>
         </div>
         <input type="hidden" name="allow_with_points" value={String(u_allow_points)} />
         <input type="hidden" name="allow_stacking" value={String(u_allow_stacking)} />
        </div>

        <div class="form-field admin-memo-field">
          <label for="uc-desc">관리자 메모 (고객에게 노출되지 않음)</label>
          <textarea id="uc-desc" name="description" class="f-input ta" rows="2"
            bind:value={u_description}></textarea>
        </div>
      </form>

    <!-- ─── 탭2: 배포 ─── -->
    {:else if activeTab === 'distribute'}
      <!-- 2026-09-23(Stephen 재설계 지시) — "전체 회원"·"특정 등급" 대상 선택은 "정보" 탭의
           "필수 회원 등급(선택)" + 아래 "상태" 토글(자동배포)과 완전히 중복되는 기능이라
           제거. 이 탭은 이제 "특정 사용자 1명에게 예외적으로 수동 지급"(채팅 쿠폰선물과는
           별개 경로) 전용. -->
      <div class="section-title">특정 사용자 수동 지급</div>
      <p class="hint">
        전체 회원·특정 분류(일반/학생/구독) 대상 배포는 "상태" 행의 자동배포 토글과
        "정보" 탭의 "필수 회원 분류"로 자동 처리됩니다. 여기서는 그 기준과 무관하게 특정 고객
        1명(또는 여러 명)에게만 예외적으로 쿠폰을 지급할 때 사용하세요.
      </p>
      <form method="POST" action="?/distributeCoupon"
        use:enhance={() => {
          distLoading = true
          return async ({ result, update }) => {
            distLoading = false
            const payload = result.type === 'success'
              ? (result.data as { ok?: boolean; error?: string } | undefined)
              : undefined
            if (payload?.ok) csToast.success('지급되었습니다.')
            else if (result.type === 'success') csToast.error(payload?.error ?? '지급에 실패했습니다.')
            await update()
          }
        }}
      >
        <input type="hidden" name="coupon_id" value={coupon.id} />
        <div class="form-field">
          <label for="dist-uuids">사용자 이메일 또는 UUID (줄바꿈 구분)</label>
          <textarea id="dist-uuids" class="f-input ta" rows="4"
            placeholder="user@example.com&#10;uuid-1234-..." bind:value={distUuids}></textarea>
          <span class="hint">이메일과 UUID를 섞어서 입력할 수 있습니다.</span>
        </div>
        <input type="hidden" name="target_type" value="specific_user" />
        <input type="hidden" name="target_meta" value={distTargetMeta ?? ''} />
        <div class="panel-actions">
          <button type="submit" class="btn-primary" disabled={distLoading || !distTargetMeta}>
            {distLoading ? '지급 중...' : '지급 실행'}
          </button>
        </div>
      </form>

      <!-- 2026-09-23(Stephen 지시) — "배포(사용)" 탭 — manage 컨텍스트에도 사용된 코드품번
           목록을 함께 보여준다. 기존에는 이 목록이 report(사용량리포트) 컨텍스트 전용
           탭에서만 보여, 발행관리에서 쿠폰을 배포한 관리자가 실제 사용 현황을 보려면
           화면을 옮겨야 했다 — 같은 데이터·같은 조회 로직(get_coupon_redemptions, 이미
           used_at DESC로 정렬됨)을 그대로 재사용해 배포 폼 바로 아래에 추가. -->
      {@render redemptionsList()}

    <!-- ─── 탭3: 채번내역 (report 컨텍스트 전용 단독 뷰) ─── -->
    {:else if activeTab === 'redemptions'}
      {@render redemptionsList()}
    {/if}

  </div>
</div>

<style>
  /* 패널 루트 (cms-uiux.md §목록카드+DetailPanel 필수 구조) */
  .panel {
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
  }

  /* 패널 헤더 */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .panel-title-wrap { display: flex; align-items: center; gap: 8px; }
  .panel-label { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .panel-id    { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); letter-spacing: .04em; }
  .panel-name  { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .panel-status {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); font-weight: 700;
    background: rgba(59,47,138,0.10); color: var(--cs-purple);
  }
  .close-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border: none; background: none; cursor: pointer;
    font-size: 14px; color: var(--cs-text-mid);
    border-radius: 6px; transition: background 0.12s;
  }
  .close-btn:hover { background: var(--cs-surface-gray); }

  /* 탭 */
  .panel-tabs { display: flex; border-bottom: 1px solid var(--cs-lilac); flex-shrink: 0; }
  .tab {
    flex: 1; padding: 10px 8px;
    background: none; border: none; border-bottom: 2px solid transparent;
    cursor: pointer; font: var(--text-pc-script-12); font-weight: 400;
    color: var(--cs-text-mid); transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .tab:hover  { color: var(--cs-purple); }
  .tab-active { color: var(--cs-purple); border-bottom-color: var(--cs-purple); font-weight: 700; }

  /* 패널 바디 — display: block 필수 (overflow:hidden 자식 압축 방지) */
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: block;
    padding: 16px 20px 20px;
  }
  .panel-body > * + * { margin-top: 10px; }

  .section-title {
    font: var(--text-pc-script-12); font-weight: 700;
    color: var(--cs-text-mid); padding: 4px 0 2px;
  }

  .info-section {
    display: flex; flex-direction: column;
    border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }
  .info-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; border-bottom: 1px solid var(--cs-lilac);
  }
  .info-row:last-child { border-bottom: none; }
  .info-label { flex: 0 0 96px; font: var(--text-pc-script-12); color: var(--cs-text-mid); font-weight: 700; }
  .info-value { flex: 1; font: var(--text-pc-body-14); color: var(--cs-text); }

  /* 토글(cms/promotion/coupon/+page.svelte .tog와 동일 패턴 재사용 — 신규 배포 토글) */
  .tog {
    position: relative; width: 40px; height: 22px; border: none;
    border-radius: var(--radius-full); background: var(--cs-disabled-toggle);
    cursor: pointer; transition: background 0.2s; flex-shrink: 0;
  }
  .tog.tog-on { background: var(--cs-purple); }
  .tog-thumb {
    position: absolute; top: 2px; left: 2px;
    width: 18px; height: 18px; border-radius: 50%;
    background: var(--cs-white); transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .tog.tog-on .tog-thumb { transform: translateX(18px); }

  /* "상태" 행에 토글+텍스트 결합 배치(2026-09-23) */
  .status-tog-row { display: flex; align-items: center; gap: 8px; }
  .tog-status-label { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }

  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-field { display: flex; flex-direction: column; gap: 6px; }
  .form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .hint { font: var(--text-pc-script-12); color: var(--cs-text-light); }

  .validity-group {
    display: flex; flex-direction: column; gap: 12px;
    margin-top: 30px; padding: 14px;
    border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm);
  }
  .radio-group { display: flex; gap: 16px; flex-wrap: wrap; }
  .radio-lbl {
    display: flex; align-items: center; gap: 6px;
    font: var(--text-pc-body-14); color: var(--cs-text);
    cursor: pointer; min-height: 28px;
  }

  .f-input {
    background: var(--cs-surface-gray); border: none;
    border-radius: var(--cms-radius-sm); padding: 10px 16px;
    font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
  }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-input.ta { resize: vertical; height: auto; }

  .panel-actions { display: flex; justify-content: flex-end; }
  .admin-memo-field { margin-top: 30px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .section-header-solo { justify-content: flex-end; margin-top: 30px; }
  .validity-group-attached { margin-top: 30px; }
  .btn-save-inline {
    padding: 5px 14px; border: 1.5px solid var(--cs-border);
    border-radius: var(--radius-sm); background: transparent; color: var(--cs-text-light);
    font: var(--text-pc-script-12); cursor: not-allowed; min-height: 32px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .btn-save-inline.dirty { border-color: var(--cs-purple); background: var(--cs-purple); color: var(--cs-white); cursor: pointer; }
  .btn-save-inline.dirty:hover { background: var(--cs-purple-hover); border-color: var(--cs-purple-hover); }

  /* ─ 2026-09-21 추가: 카테고리 피커 + CMS 표준 콤보버튼(.s-chip, cms-uiux.md §7-12-B) —
       coupon/new/+page.svelte와 동일 스타일 토큰(공유 컴포넌트가 아니라 각 화면이 로컬
       CSS로 복제하는 기존 관례) ─ */
  .cat-picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .cat-chip {
    padding: 4px 12px; border-radius: var(--radius-sm);
    border: 1.5px solid var(--cs-border); background: transparent;
    font: var(--text-pc-script-12); color: var(--cs-text-mid);
    cursor: pointer; min-height: 28px; transition: all 0.12s;
  }
  .cat-chip.selected { border-color: var(--cs-purple); background: rgba(59,47,138,0.08); color: var(--cs-purple); }

  .s-chip-group { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
  .s-chip {
    height: 32px; padding: 0 14px;
    border: 1.5px solid var(--cs-lilac);
    border-radius: var(--cms-radius-xl, 30px);
    background: var(--cs-white); color: var(--cs-text-mid);
    font: var(--text-pc-script-12); font-weight: 600;
    cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .s-chip--on { background: var(--cs-purple); color: var(--cs-white); border-color: var(--cs-purple); }
  .s-chip:not(.s-chip--on):hover { border-color: var(--cs-purple); color: var(--cs-purple); }

  /* 채번내역 탭 */
  .redemption-list { display: flex; flex-direction: column; gap: 8px; }
  .redemption-row {
    display: flex; flex-direction: row; align-items: center; gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm);
    text-decoration: none;
  }
  .redemption-row--linked { cursor: pointer; transition: border-color 0.12s, background 0.12s; }
  .redemption-row--linked:hover { border-color: var(--cs-purple); background: var(--cs-purple-op10); }
  .redemption-code {
    font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text);
    letter-spacing: .04em;
    flex: 0 0 auto;
  }
  .redemption-meta {
    font: var(--text-pc-script-12); color: var(--cs-text-mid);
    flex: 0 0 auto; white-space: nowrap;
  }
  .redemption-user {
    font: var(--text-pc-script-12); color: var(--cs-text-light);
    flex: 1 1 auto; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    text-align: right;
  }

  /* cms-uiux.md §7-3 ① CTA 기본(ctaPrimary) 표준 스펙 그대로 — 기존 로컬 정의(36px/8px
     라운드)는 실제로는 app.css .cms-shell .btn-primary 전역 규칙에 가려져 렌더링에는
     반영되지 않았으나, 컴포넌트 자체가 지침과 다른 값을 갖고 있던 결함이라 정정. */
  .btn-primary {
    display: inline-flex; align-items: center;
    background: var(--cs-purple); color: var(--cs-white); border: none;
    border-radius: var(--radius-md); padding: 0 30px;
    font: var(--text-pc-body-14); letter-spacing: -0.5px;
    height: 44px; cursor: pointer;
    transition: background 0.12s; white-space: nowrap; box-shadow: none;
  }
  .btn-primary:hover    { background: var(--cs-purple-hover); }
  .btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
</style>
