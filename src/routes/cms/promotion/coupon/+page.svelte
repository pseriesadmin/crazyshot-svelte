<script lang="ts">
  import { enhance } from '$app/forms'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { Coupon } from '$lib/types/database'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  // ─ 탭 ─
  const TABS = [
    { id: 'dashboard',  label: '대시보드' },
    { id: 'manage',     label: '발행 관리' },
    { id: 'distribute', label: '직접 배포' },
    { id: 'report',     label: '사용량 리포트' },
    { id: 'expire',     label: '만료 관리' },
  ] as const

  let activeTab = $state(data.tab)

  function switchTab(id: string) {
    activeTab = id
    const u = new URL(page.url)
    u.searchParams.set('tab', id)
    goto(u.toString(), { replaceState: true, invalidateAll: true })
  }

  // ─ 폼 토글 ─
  let showCreateForm = $state(false)

  // ─ 쿠폰 생성 폼 상태 ─
  let createLoading = $state(false)
  let f_code        = $state('')
  let f_type        = $state('fixed')
  let f_discount_type  = $state('fixed')
  let f_discount_value = $state(0)
  let f_max_discount   = $state(0)
  let f_per_user_limit = $state(1)
  let f_total_limit    = $state(0)
  let f_min_rental_amount = $state(0)
  let f_min_rental_days   = $state(0)
  let f_user_grade     = $state('')
  let f_validity_type  = $state<'fixed_period' | 'unlimited'>('fixed_period')
  let f_valid_from     = $state('')
  let f_valid_until    = $state('')
  let f_allow_points   = $state(true)
  let f_allow_stacking = $state(false)
  let f_first_rental   = $state(false)
  let f_student        = $state(false)
  let f_walk_in        = $state(false)
  let f_subscription   = $state(false)
  let f_auto_issue     = $state(false)
  let f_auto_sched_type = $state<'monthly' | 'period'>('monthly')
  let f_auto_day       = $state(1)
  let f_auto_from      = $state('')
  let f_auto_to        = $state('')
  let f_dist_target    = $state<'all' | 'grade'>('all')
  let f_dist_grade     = $state('')
  let f_categories     = $state<string[]>([])
  let f_description    = $state('')

  // 코드 자동 생성
  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    f_code = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  }

  // 카테고리 토글
  const ALL_CATS = ['CAM','OPT','LGT','AUD','SPT','MON','PWR','MED','STD','VID','ACC','PKG']
  function toggleCat(c: string) {
    f_categories = f_categories.includes(c)
      ? f_categories.filter(x => x !== c)
      : [...f_categories, c]
  }

  let autoScheduleJson = $derived(
    f_auto_sched_type === 'monthly'
      ? JSON.stringify({ type: 'monthly', day: f_auto_day })
      : JSON.stringify({ type: 'period', from: f_auto_from, to: f_auto_to })
  )

  let distTargetJson = $derived(
    f_dist_target === 'grade'
      ? JSON.stringify({ type: 'grade', meta: f_dist_grade })
      : JSON.stringify({ type: 'all' })
  )

  // ─ 배포 폼 상태 ─
  let distCouponId = $state('')
  let distTargetT  = $state<'all' | 'grade' | 'specific_user'>('all')
  let distGrade    = $state('')
  let distUuids    = $state('')
  let distLoading  = $state(false)

  let distTargetMeta = $derived(
    distTargetT === 'grade'
      ? JSON.stringify({ grade: distGrade })
      : distTargetT === 'specific_user' && distUuids.trim()
        ? JSON.stringify({ user_ids: distUuids.split('\n').map((s: string) => s.trim()).filter(Boolean) })
        : null
  )

  // ─ 만료 연장 상태 ─
  let reportFrom = $state(data.from.substring(0, 10))
  let reportTo   = $state(data.to.substring(0, 10))

  let extendCouponId = $state('')
  let extendNewUntil = $state('')
  let extendLoading  = $state(false)

  // ─ 삭제 확인 ─
  let deleteId        = $state('')
  let deleteCode      = $state('')
  let showDeleteModal = $state(false)

  function confirmDelete(c: Coupon) {
    deleteId   = c.id
    deleteCode = c.code
    showDeleteModal = true
  }

  // ─ action 결과 처리 ─
  $effect(() => {
    if (!form) return
    if (form.ok) {
      csToast.success('완료되었습니다.')
      showCreateForm  = false
      showDeleteModal = false
      extendCouponId  = ''
    } else if ('error' in form && form.error) {
      csToast.error(String(form.error))
    }
  })

  // ─ 유틸 ─
  function discountLabel(c: Coupon): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cc = c as unknown as any
    if (c.discount_type === 'percentage') {
      const max = cc.max_discount_amount ? ` (최대 ${Number(cc.max_discount_amount).toLocaleString()}원)` : ''
      return `${c.discount_value}%${max}`
    }
    if (c.discount_type === 'fixed') return `${c.discount_value.toLocaleString()}원`
    return '무료배송'
  }

  function typeLabel(type: string): string {
    const MAP: Record<string, string> = {
      fixed: '정액', percent: '정률', free_delivery: '무료배송',
      first_rental: '첫렌탈', category: '카테고리', bundle: '번들',
      subscription: '구독전용', student: '학생전용', walk_in: '방문픽업',
      reactivation: '휴면복귀', referral: '추천인', event: '이벤트', all: '전체',
    }
    return MAP[type] ?? type
  }

  function formatDate(d: string | null | undefined): string {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' })
  }
</script>

<div class="page-wrap">
  <!-- 서브탭 -->
  <div class="sub-tabs">
    {#each TABS as t}
      <button
        class="sub-tab-btn"
        class:active={activeTab === t.id}
        onclick={() => switchTab(t.id)}
      >{t.label}</button>
    {/each}
  </div>

  <!-- ────────────────────────────────────────────
       탭1: 대시보드
  ──────────────────────────────────────────── -->
  {#if activeTab === 'dashboard'}
    <div class="section-title">쿠폰 현황</div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">총 발급 수</span>
        <span class="kpi-val">{data.stats.total_issued.toLocaleString()}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">현재 활성</span>
        <span class="kpi-val kv-active">{data.stats.total_active.toLocaleString()}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">누적 사용</span>
        <span class="kpi-val">{data.stats.total_used.toLocaleString()}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">만료 수</span>
        <span class="kpi-val kv-muted">{data.stats.total_expired.toLocaleString()}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">총 할인 제공액</span>
        <span class="kpi-val">{data.stats.total_discount_amount.toLocaleString()}원</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">쿠폰 사용 전환율</span>
        <span class="kpi-val">{data.stats.conversion_rate}%</span>
      </div>
    </div>

    {#if data.expiringSoon.length > 0}
      <div class="expire-alert">
        <div class="expire-alert-title">⚠ 만료 임박 쿠폰 (7일 이내)</div>
        {#each data.expiringSoon.slice(0, 5) as c}
          <div class="expire-row">
            <span class="expire-code">{c.code}</span>
            <span class="badge badge-info">{typeLabel(c.type)}</span>
            <span class="expire-date">{formatDate(c.valid_until)}</span>
          </div>
        {/each}
      </div>
    {/if}

  <!-- ────────────────────────────────────────────
       탭2: 발행 관리
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'manage'}
    <div class="toolbar">
      <span class="section-title nm">쿠폰 목록</span>
      <button class="btn-primary" onclick={() => showCreateForm = !showCreateForm}>
        {showCreateForm ? '닫기' : '+ 쿠폰 생성'}
      </button>
    </div>

    {#if showCreateForm}
      <div class="form-card">
        <form method="POST" action="?/createCoupon"
          use:enhance={() => {
            createLoading = true
            return ({ update }) => { createLoading = false; update() }
          }}
        >
          <div class="fs-title">기본 정보</div>
          <div class="form-grid">
            <div class="form-field">
              <label for="fc-code">쿠폰 코드</label>
              <div class="row-gap">
                <input id="fc-code" name="code" class="f-input" bind:value={f_code} required />
                <button type="button" class="btn-ghost" onclick={generateCode}>자동 생성</button>
              </div>
            </div>
            <div class="form-field">
              <label for="fc-type">쿠폰 유형</label>
              <select id="fc-type" name="type" class="f-input" bind:value={f_type}>
                <option value="fixed">정액 할인</option>
                <option value="percent">정률 할인 (%)</option>
                <option value="free_delivery">무료 배송</option>
                <option value="first_rental">첫 렌탈 전용</option>
                <option value="category">카테고리 한정</option>
                <option value="bundle">번들 렌탈</option>
                <option value="subscription">정기구독 전용</option>
                <option value="student">학생 신학기</option>
                <option value="walk_in">방문 픽업</option>
                <option value="reactivation">휴면 복귀</option>
                <option value="referral">추천인</option>
                <option value="event">이벤트</option>
              </select>
            </div>
            <div class="form-field">
              <label for="fc-dtype">할인 방식</label>
              <select id="fc-dtype" name="discount_type" class="f-input" bind:value={f_discount_type}>
                <option value="fixed">정액 (원)</option>
                <option value="percent">정률 (%)</option>
                <option value="free_shipping">무료배송</option>
              </select>
            </div>
            <div class="form-field">
              <label for="fc-dval">할인값</label>
              <input id="fc-dval" name="discount_value" type="number" min="0"
                class="f-input" bind:value={f_discount_value} />
            </div>
            {#if f_discount_type === 'percent'}
              <div class="form-field">
                <label for="fc-maxd">최대 할인 한도 (원, 0=무제한)</label>
                <input id="fc-maxd" name="max_discount_amount" type="number" min="0"
                  class="f-input" bind:value={f_max_discount} />
              </div>
            {/if}
          </div>

          <div class="fs-title">사용 제한</div>
          <div class="form-grid">
            <div class="form-field">
              <label for="fc-mra">최소 렌탈 금액 (원, 0=없음)</label>
              <input id="fc-mra" name="min_rental_amount" type="number" min="0"
                class="f-input" bind:value={f_min_rental_amount} />
            </div>
            <div class="form-field">
              <label for="fc-mrd">최소 렌탈 기간 (일, 0=없음)</label>
              <input id="fc-mrd" name="min_rental_days" type="number" min="0"
                class="f-input" bind:value={f_min_rental_days} />
            </div>
            <div class="form-field">
              <label for="fc-pul">1인당 사용 횟수</label>
              <input id="fc-pul" name="per_user_limit" type="number" min="1"
                class="f-input" bind:value={f_per_user_limit} />
            </div>
            <div class="form-field">
              <label for="fc-tul">전체 발급 한도 (0=무제한)</label>
              <input id="fc-tul" name="total_usage_limit" type="number" min="0"
                class="f-input" bind:value={f_total_limit} />
            </div>
            <div class="form-field">
              <label for="fc-grade">필수 회원 등급 (선택)</label>
              <select id="fc-grade" name="user_grade_required" class="f-input" bind:value={f_user_grade}>
                <option value="">전체 회원</option>
                <option value="BASIC">BASIC</option>
                <option value="PRO">PRO</option>
                <option value="CRAZY">CRAZY</option>
              </select>
            </div>
          </div>

          {#if f_type === 'category'}
            <div class="fs-title">적용 카테고리</div>
            <div class="cat-picker">
              {#each ALL_CATS as cat}
                <button type="button" class="cat-chip"
                  class:selected={f_categories.includes(cat)}
                  onclick={() => toggleCat(cat)}>{cat}</button>
              {/each}
            </div>
            <input type="hidden" name="applicable_categories"
              value={f_categories.length ? JSON.stringify(f_categories) : ''} />
          {/if}

          <div class="fs-title">전용 조건</div>
          <div class="toggle-group">
            <div class="toggle-row">
              <span>첫 렌탈 전용</span>
              <button type="button" class="tog" class:tog-on={f_first_rental}
                role="switch" aria-checked={f_first_rental}
                onclick={() => f_first_rental = !f_first_rental}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="is_first_rental_only" value={String(f_first_rental)} />
            </div>
            <div class="toggle-row">
              <span>학생 인증 계정 전용 <em>(is_student 검증)</em></span>
              <button type="button" class="tog" class:tog-on={f_student}
                role="switch" aria-checked={f_student}
                onclick={() => f_student = !f_student}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="is_student_only" value={String(f_student)} />
            </div>
            <div class="toggle-row">
              <span>방문 픽업 전용 <em>(shipment_type=pickup 검증)</em></span>
              <button type="button" class="tog" class:tog-on={f_walk_in}
                role="switch" aria-checked={f_walk_in}
                onclick={() => f_walk_in = !f_walk_in}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="is_walk_in_only" value={String(f_walk_in)} />
            </div>
            <div class="toggle-row">
              <span>정기구독 전용 <em>(PRD 구독 플랜 연계)</em></span>
              <button type="button" class="tog" class:tog-on={f_subscription}
                role="switch" aria-checked={f_subscription}
                onclick={() => f_subscription = !f_subscription}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="is_subscription_only" value={String(f_subscription)} />
            </div>
          </div>

          <div class="fs-title">결합 옵션</div>
          <div class="toggle-group">
            <div class="toggle-row">
              <span>포인트 결합 사용 허용</span>
              <button type="button" class="tog" class:tog-on={f_allow_points}
                role="switch" aria-checked={f_allow_points}
                onclick={() => f_allow_points = !f_allow_points}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="allow_with_points" value={String(f_allow_points)} />
            </div>
            <div class="toggle-row">
              <span>쿠폰 중복 사용 허용 <em>(복수 쿠폰 동시 적용)</em></span>
              <button type="button" class="tog" class:tog-on={f_allow_stacking}
                role="switch" aria-checked={f_allow_stacking}
                onclick={() => f_allow_stacking = !f_allow_stacking}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="allow_stacking" value={String(f_allow_stacking)} />
            </div>
          </div>

          <div class="fs-title">유효기간</div>
          <div class="radio-group">
            <label class="radio-lbl">
              <input type="radio" name="validity_type" value="fixed_period"
                bind:group={f_validity_type} />
              제한 기간 (from~until)
            </label>
            <label class="radio-lbl">
              <input type="radio" name="validity_type" value="unlimited"
                bind:group={f_validity_type} />
              무제한 (만료일 없음)
            </label>
          </div>
          {#if f_validity_type === 'fixed_period'}
            <div class="form-grid">
              <div class="form-field">
                <label for="fc-vf">시작일</label>
                <CmsDatePicker bind:value={f_valid_from} name="valid_from" placeholder="시작일 선택" disablePast={false} />
              </div>
              <div class="form-field">
                <label for="fc-vu">종료일</label>
                <CmsDatePicker bind:value={f_valid_until} name="valid_until" placeholder="종료일 선택" disablePast={false} />
              </div>
            </div>
          {/if}

          <div class="fs-title">자동 발행</div>
          <div class="toggle-group">
            <div class="toggle-row">
              <span>자동 발행 활성화</span>
              <button type="button" class="tog" class:tog-on={f_auto_issue}
                role="switch" aria-checked={f_auto_issue}
                onclick={() => f_auto_issue = !f_auto_issue}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="auto_issue_enabled" value={String(f_auto_issue)} />
            </div>
          </div>
          {#if f_auto_issue}
            <div class="auto-box">
              <div class="radio-group">
                <label class="radio-lbl">
                  <input type="radio" bind:group={f_auto_sched_type} value="monthly" />
                  매월 n일 발행
                </label>
                <label class="radio-lbl">
                  <input type="radio" bind:group={f_auto_sched_type} value="period" />
                  특정 기간 발행
                </label>
              </div>
              {#if f_auto_sched_type === 'monthly'}
                <div class="form-field" style="max-width:160px">
                  <label for="fc-aday">발행일 (1~31)</label>
                  <input id="fc-aday" type="number" min="1" max="31" class="f-input"
                    bind:value={f_auto_day} />
                </div>
              {:else}
                <div class="form-grid">
                  <div class="form-field">
                    <label for="fc-af">시작일</label>
                    <CmsDatePicker bind:value={f_auto_from} placeholder="시작일 선택" disablePast={false} />
                  </div>
                  <div class="form-field">
                    <label for="fc-at">종료일</label>
                    <CmsDatePicker bind:value={f_auto_to} placeholder="종료일 선택" disablePast={false} />
                  </div>
                </div>
              {/if}
              <input type="hidden" name="auto_issue_schedule" value={autoScheduleJson} />
              <div class="fs-title sm">배포 대상</div>
              <div class="radio-group">
                <label class="radio-lbl">
                  <input type="radio" bind:group={f_dist_target} value="all" />
                  전체 회원
                </label>
                <label class="radio-lbl">
                  <input type="radio" bind:group={f_dist_target} value="grade" />
                  특정 등급
                </label>
              </div>
              {#if f_dist_target === 'grade'}
                <select class="f-input" style="max-width:200px;margin-top:6px"
                  bind:value={f_dist_grade}>
                  <option value="BASIC">BASIC</option>
                  <option value="PRO">PRO</option>
                  <option value="CRAZY">CRAZY</option>
                </select>
              {/if}
              <input type="hidden" name="distribution_target" value={distTargetJson} />
            </div>
          {/if}

          <div class="form-field" style="margin-top:16px">
            <label for="fc-desc">설명 (선택)</label>
            <input id="fc-desc" name="description" class="f-input"
              bind:value={f_description} placeholder="내부 메모용 설명" />
          </div>

          <div class="form-actions">
            <button type="button" class="btn-ghost" onclick={() => showCreateForm = false}>취소</button>
            <button type="submit" class="btn-primary" disabled={createLoading}>
              {createLoading ? '저장 중...' : '쿠폰 생성'}
            </button>
          </div>
        </form>
      </div>
    {/if}

    <!-- 목록 테이블 -->
    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>코드</th><th>유형</th><th>할인</th>
            <th>유효기간</th><th>사용/한도</th><th>상태</th><th>관리</th>
          </tr>
        </thead>
        <tbody>
          {#each data.coupons as c}
            {@const cc = c as unknown as Record<string, unknown>}
            <tr>
              <td class="td-code">{c.code}</td>
              <td><span class="badge badge-info">{typeLabel(c.type)}</span></td>
              <td>{discountLabel(c)}</td>
              <td class="td-date">
                {#if cc.validity_type === 'unlimited'}
                  <span class="badge badge-active">무제한</span>
                {:else}
                  {formatDate(c.valid_from)} ~ {formatDate(c.valid_until)}
                {/if}
              </td>
              <td>{c.usage_count} / {c.usage_limit ?? '∞'}</td>
              <td>
                <form method="POST" action="?/toggleCoupon" use:enhance>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="is_active" value={String(c.is_active)} />
                  <button type="submit" class="tog" class:tog-on={c.is_active}
                    role="switch" aria-checked={c.is_active} aria-label="활성화 토글">
                    <span class="tog-thumb"></span>
                  </button>
                </form>
              </td>
              <td>
                <button class="btn-danger sm" onclick={() => confirmDelete(c)}>삭제</button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="7" class="no-data">등록된 쿠폰이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

  <!-- ────────────────────────────────────────────
       탭3: 직접 배포
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'distribute'}
    <div class="section-title">쿠폰 직접 배포</div>
    <div class="form-card">
      <form method="POST" action="?/distributeCoupon"
        use:enhance={() => {
          distLoading = true
          return ({ update }) => { distLoading = false; update() }
        }}
      >
        <div class="form-grid">
          <div class="form-field form-full">
            <label for="dist-coupon">배포할 쿠폰</label>
            <select id="dist-coupon" name="coupon_id" class="f-input"
              bind:value={distCouponId} required>
              <option value="">— 쿠폰 선택 —</option>
              {#each data.coupons.filter(c => c.is_active) as c}
                <option value={c.id}>{c.code} ({typeLabel(c.type)})</option>
              {/each}
            </select>
          </div>
          <div class="form-field form-full">
            <label>배포 대상</label>
            <div class="radio-group">
              <label class="radio-lbl">
                <input type="radio" bind:group={distTargetT} value="all" />
                전체 회원
              </label>
              <label class="radio-lbl">
                <input type="radio" bind:group={distTargetT} value="grade" />
                특정 등급
              </label>
              <label class="radio-lbl">
                <input type="radio" bind:group={distTargetT} value="specific_user" />
                특정 사용자 UUID
              </label>
            </div>
          </div>
          {#if distTargetT === 'grade'}
            <div class="form-field">
              <label for="dist-grade">등급</label>
              <select id="dist-grade" class="f-input" bind:value={distGrade}>
                <option value="BASIC">BASIC</option>
                <option value="PRO">PRO</option>
                <option value="CRAZY">CRAZY</option>
              </select>
            </div>
          {/if}
          {#if distTargetT === 'specific_user'}
            <div class="form-field form-full">
              <label for="dist-uuids">사용자 UUID (줄바꿈 구분)</label>
              <textarea id="dist-uuids" class="f-input ta" rows="5"
                placeholder="uuid-1&#10;uuid-2" bind:value={distUuids}></textarea>
            </div>
          {/if}
        </div>
        <input type="hidden" name="target_type" value={distTargetT} />
        <input type="hidden" name="target_meta" value={distTargetMeta ?? ''} />
        <div class="form-actions">
          <button type="submit" class="btn-primary"
            disabled={distLoading || !distCouponId}>
            {distLoading ? '배포 중...' : '배포 실행'}
          </button>
        </div>
      </form>
    </div>

    {#if data.distributions.length > 0}
      <div class="section-title">배포 이력</div>
      <div class="table-card">
        <table>
          <thead>
            <tr><th>배포일</th><th>쿠폰 코드</th><th>대상</th><th>발급 수</th></tr>
          </thead>
          <tbody>
            {#each data.distributions as d}
              <tr>
                <td class="td-date">{formatDate(d.created_at)}</td>
                <td class="td-code">{d.coupons?.code ?? '—'}</td>
                <td>{d.target_type}</td>
                <td>{d.issued_count.toLocaleString()}명</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  <!-- ────────────────────────────────────────────
       탭4: 사용량 리포트
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'report'}
    <div class="toolbar">
      <span class="section-title nm">사용량 리포트</span>
      <form method="GET" class="filter-form">
        <input type="hidden" name="tab" value="report" />
        <select name="period" class="f-input sm">
          <option value="day"   selected={data.period === 'day'}>일별</option>
          <option value="month" selected={data.period === 'month'}>월별</option>
          <option value="year"  selected={data.period === 'year'}>연별</option>
        </select>
        <CmsDatePicker bind:value={reportFrom} name="from" placeholder="시작일" disablePast={false} />
        <CmsDatePicker bind:value={reportTo} name="to" placeholder="종료일" disablePast={false} />
        <button type="submit" class="btn-primary">조회</button>
      </form>
    </div>
    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>기간</th><th>쿠폰 코드</th><th>유형</th>
            <th>발급 수</th><th>사용 수</th><th>전환율</th>
          </tr>
        </thead>
        <tbody>
          {#each data.usageReport as r}
            <tr>
              <td>{r.period}</td>
              <td class="td-code">{r.coupon_code}</td>
              <td><span class="badge badge-info">{typeLabel(r.coupon_type)}</span></td>
              <td>{r.issued_count.toLocaleString()}</td>
              <td>{r.used_count.toLocaleString()}</td>
              <td>{r.conversion_pct}%</td>
            </tr>
          {:else}
            <tr><td colspan="6" class="no-data">리포트 데이터가 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

  <!-- ────────────────────────────────────────────
       탭5: 만료 관리
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'expire'}
    <div class="section-title">만료 임박 (7일 이내)</div>
    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>쿠폰 코드</th><th>유형</th>
            <th>사용/한도</th><th>만료일</th><th>연장</th>
          </tr>
        </thead>
        <tbody>
          {#each data.expiringSoon as c}
            <tr>
              <td class="td-code">{c.code}</td>
              <td><span class="badge badge-info">{typeLabel(c.type)}</span></td>
              <td>{c.usage_count} / {c.usage_limit ?? '∞'}</td>
              <td class="td-date">{formatDate(c.valid_until)}</td>
              <td>
                <button class="btn-ghost sm"
                  onclick={() => { extendCouponId = c.id; extendNewUntil = '' }}>
                  기간 연장
                </button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="5" class="no-data">만료 임박 쿠폰이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="section-title" style="margin-top:20px">만료 완료</div>
    <div class="table-card">
      <table>
        <thead>
          <tr><th>쿠폰 코드</th><th>유형</th><th>총 사용</th><th>만료일</th></tr>
        </thead>
        <tbody>
          {#each data.expiredCoupons as c}
            <tr>
              <td class="td-code">{c.code}</td>
              <td><span class="badge badge-inactive">{typeLabel(c.type)}</span></td>
              <td>{c.usage_count}</td>
              <td class="td-date">{formatDate(c.valid_until)}</td>
            </tr>
          {:else}
            <tr><td colspan="4" class="no-data">만료된 쿠폰이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- 기간 연장 모달 -->
{#if extendCouponId}
  <div class="modal-bg" onclick={() => extendCouponId = ''} role="presentation">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="기간 연장">
      <p class="modal-title">쿠폰 유효기간 연장</p>
      <form method="POST" action="?/extendCoupon"
        use:enhance={() => {
          extendLoading = true
          return ({ update }) => { extendLoading = false; update() }
        }}
      >
        <input type="hidden" name="coupon_id" value={extendCouponId} />
        <div class="form-field">
          <label for="ext-until">새 만료일</label>
          <CmsDatePicker bind:value={extendNewUntil} name="new_until" placeholder="새 만료일 선택" disablePast={false} />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onclick={() => extendCouponId = ''}>취소</button>
          <button type="submit" class="btn-primary" disabled={extendLoading}>
            {extendLoading ? '처리 중...' : '연장 확인'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- 삭제 확인 모달 -->
{#if showDeleteModal}
  <div class="modal-bg" onclick={() => showDeleteModal = false} role="presentation">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="삭제 확인">
      <p class="modal-title">쿠폰 삭제</p>
      <p class="modal-sub"><strong>{deleteCode}</strong> 쿠폰을 삭제합니다.<br>이 작업은 되돌릴 수 없습니다.</p>
      <form method="POST" action="?/deleteCoupon" use:enhance>
        <input type="hidden" name="id" value={deleteId} />
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onclick={() => showDeleteModal = false}>취소</button>
          <button type="submit" class="btn-danger">삭제</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
/* ─ 레이아웃 ─ */
.page-wrap {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 20px 24px 32px;
}

/* ─ 서브탭 ─ */
.sub-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.sub-tab-btn {
  padding: 6px 18px; border: none;
  border-radius: var(--cms-radius-sm);
  background: transparent; color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer;
  min-height: 34px; transition: background 0.15s, color 0.15s;
}
.sub-tab-btn:hover  { background: rgba(59,47,138,0.08); color: var(--cs-text); }
.sub-tab-btn.active { background: var(--cs-white); color: var(--cs-purple); }

/* ─ 섹션 타이틀 ─ */
.section-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 16px; }
.section-title.nm { margin: 0; }

/* ─ KPI 그리드 ─ */
.kpi-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 12px; margin-bottom: 20px;
}
.kpi-card {
  background: var(--cs-white); border-radius: var(--cms-radius-md);
  padding: 20px 24px; display: flex; flex-direction: column; gap: 8px;
}
.kpi-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
.kpi-val   { font: var(--text-pc-title-18); color: var(--cs-text); }
.kv-active { color: var(--cs-purple); }
.kv-muted  { color: var(--cs-text-light); }

/* ─ 만료 임박 알림 ─ */
.expire-alert {
  background: var(--cs-white); border-radius: var(--cms-radius-md);
  border-left: 3px solid var(--cs-warning);
  padding: 16px 20px; margin-bottom: 16px;
}
.expire-alert-title { font: var(--text-pc-body-14); color: var(--cs-text); margin-bottom: 10px; }
.expire-row  { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; font: var(--text-pc-script-12); }
.expire-code { font: var(--text-pc-body-14); color: var(--cs-text); }
.expire-date { color: var(--cs-text-mid); margin-left: auto; }

/* ─ 툴바 ─ */
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }

/* ─ 카드 ─ */
.form-card {
  background: var(--cs-white); border-radius: var(--cms-radius-lg);
  padding: 28px; margin-bottom: 16px;
}

.fs-title {
  font: var(--text-pc-body-14); color: var(--cs-purple);
  margin: 20px 0 10px;
  border-bottom: 1px solid var(--cs-surface-gray); padding-bottom: 6px;
}
.fs-title:first-child { margin-top: 0; }
.fs-title.sm { margin-top: 12px; font: var(--text-pc-script-12); }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-full { grid-column: 1 / -1; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

.row-gap { display: flex; gap: 8px; align-items: stretch; }
.row-gap .f-input { flex: 1; }

/* ─ 카테고리 피커 ─ */
.cat-picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.cat-chip {
  padding: 4px 12px; border-radius: var(--radius-sm);
  border: 1.5px solid var(--cs-border); background: transparent;
  font: var(--text-pc-script-12); color: var(--cs-text-mid);
  cursor: pointer; min-height: 28px; transition: all 0.12s;
}
.cat-chip.selected { border-color: var(--cs-purple); background: rgba(59,47,138,0.08); color: var(--cs-purple); }

/* ─ 토글 그룹 ─ */
.toggle-group { display: flex; flex-direction: column; gap: 10px; margin-bottom: 4px; }
.toggle-row {
  display: flex; align-items: center; gap: 12px;
  font: var(--text-pc-body-14); color: var(--cs-text);
}
.toggle-row em { font-style: normal; font: var(--text-pc-script-12); color: var(--cs-text-light); }

/* ─ 라디오 ─ */
.radio-group { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; }
.radio-lbl {
  display: flex; align-items: center; gap: 6px;
  font: var(--text-pc-body-14); color: var(--cs-text);
  cursor: pointer; min-height: 28px;
}

/* ─ 자동 발행 박스 ─ */
.auto-box {
  background: var(--cs-lilac); border-radius: var(--cms-radius-sm);
  padding: 16px; margin-top: 8px;
}

/* ─ 필터 폼 ─ */
.filter-form { display: flex; gap: 8px; align-items: center; }
.f-input.sm  { padding: 6px 10px; font: var(--text-pc-script-12); height: 32px; }

/* ─ 폼 액션 ─ */
.form-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  margin-top: 20px; padding-top: 16px;
  border-top: 1px solid var(--cs-surface-gray);
}

/* ─ 테이블 ─ */
.table-card {
  background: var(--cs-white); border-radius: var(--cms-radius-md);
  overflow: hidden; margin-bottom: 16px;
}
table { width: 100%; border-collapse: collapse; font: var(--text-pc-body-14); color: var(--cs-text); }
thead th {
  background: var(--cs-lilac); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); padding: 10px 16px;
  text-align: left; white-space: nowrap;
}
tbody tr { border-bottom: 1px solid var(--cs-surface-gray); }
tbody tr:hover { background: rgba(59,47,138,0.04); }
tbody tr:last-child { border-bottom: none; }
td { padding: 10px 16px; vertical-align: middle; }
.td-code { font: var(--text-pc-body-14); color: var(--cs-purple); letter-spacing: .04em; }
.td-date { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.no-data { text-align: center; color: var(--cs-text-light); padding: 32px; }

/* ─ 배지 ─ */
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); white-space: nowrap;
}
.badge-active   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
.badge-inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }
.badge-info     { background: rgba(59,47,138,0.08); color: var(--cs-purple); }

/* ─ 토글 ─ */
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

/* ─ 버튼 ─ */
.btn-primary {
  background: var(--cs-purple); color: var(--cs-white); border: none;
  border-radius: var(--radius-sm); padding: 8px 16px;
  font: var(--text-pc-body-14); height: 36px; cursor: pointer;
  transition: background 0.15s; white-space: nowrap;
}
.btn-primary:hover    { background: var(--cs-purple-hover); }
.btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
.btn-ghost {
  background: transparent; border: 1.5px solid var(--cs-purple);
  border-radius: var(--radius-sm); color: var(--cs-purple);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s; white-space: nowrap;
}
.btn-ghost:hover { background: rgba(59,47,138,0.06); }
.btn-danger {
  background: transparent; border: 1.5px solid var(--cs-red-badge);
  border-radius: var(--radius-sm); color: var(--cs-red-badge);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s;
}
.btn-danger:hover { background: rgba(255,53,53,0.08); }
.btn-danger.sm, .btn-ghost.sm, .btn-primary.sm {
  padding: 4px 10px; height: 28px; font: var(--text-pc-script-12);
}

/* ─ 입력 필드 ─ */
.f-input {
  background: var(--cs-surface-gray); border: none;
  border-radius: var(--cms-radius-sm); padding: 10px 16px;
  font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
}
.f-input::placeholder { color: var(--cs-text-placeholder); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
.f-input.ta { resize: vertical; height: auto; }

/* ─ 모달 ─ */
.modal-bg {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(16,11,50,0.45);
  display: flex; align-items: center; justify-content: center;
}
.modal-box {
  background: var(--cs-white); border-radius: var(--cms-radius-lg);
  padding: 28px 32px; min-width: 320px; max-width: 440px; width: 100%;
}
.modal-title   { font: var(--text-pc-title-16); color: var(--cs-text); margin: 0 0 8px; }
.modal-sub     { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 20px; line-height: 1.6; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
</style>
