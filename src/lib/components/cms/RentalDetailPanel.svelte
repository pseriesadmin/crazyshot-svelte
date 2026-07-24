<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import RentalContractViewer from '$lib/components/cms/RentalContractViewer.svelte'
  import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'

  interface RentalListRow {
    reservation_id:    number
    reservation_code:  string | null
    status:            string
    rental_start:      string
    rental_end:        string
    rental_days:       number | null
    pickup_method:     string | null
    return_method:     string | null
    pickup_time:       string | null
    return_time:       string | null
    user_id:           string
    customer_name:     string
    customer_email:    string
    customer_phone:    string
    membership_grade:  string
    credit_score:      number
    product_id:        string
    product_name:      string
    product_code:      string | null
    product_category:  string
    product_image_url: string | null
    order_id:          number | null
    order_key:         string | null
    order_amount:      number | null
    discount_amount:   number | null
    tax_amount:        number | null
    payment_status:    string | null
    contract_id:       string | null
    contract_status:   string | null
    contract_pdf_url:  string | null
    auto_signed_at:    string | null
    customer_signed_at: string | null
    signing_sent_at:   string | null
    signing_token:     string | null
    created_at:        string
    total_count:       number
  }

  interface PaymentDetail {
    toss_order_id:   string | null
    payment_key:     string | null
    payment_method:  string | null
    total_amount:    number | null
    paid_amount:     number | null
    point_amount:    number | null
    coupon_discount: number | null
    confirmed_at:    string | null
    toss_response:   Record<string, unknown> | null
  }

  interface Props {
    row:          RentalListRow
    onclose:      () => void
    onrefresh:    () => void
    stepFilter?:  string[]
    isRentalView?: boolean   // true = /cms/rentals 컨텍스트 (예약 단계 UI 숨김)
  }
  let { row, onclose, onrefresh, stepFilter, isRentalView = false }: Props = $props()

  let activeTab   = $state<'rental' | 'customer' | 'payment' | 'contract'>('rental')
  let isSubmitting = $state(false)

  let fetchedForId    = $state<number | null>(null)
  let paymentDetail   = $state<PaymentDetail | null>(null)
  let paymentLoading  = $state(false)
  let paymentError    = $state<string | null>(null)

  $effect(() => {
    if (activeTab !== 'payment') return
    if (paymentLoading) return
    if (fetchedForId === row.reservation_id) return

    const id = row.reservation_id
    fetchedForId   = id
    paymentDetail  = null
    paymentError   = null
    paymentLoading = true

    fetch(`/api/cms/reservations/${id}/payment`)
      .then(r => r.json())
      .then(d => {
        if (fetchedForId === id) {
          if (d.payment) {
            paymentDetail = { ...d.payment, toss_order_id: d.payment.order_id ?? null }
          } else {
            paymentDetail = null
          }
          paymentLoading = false
        }
      })
      .catch(() => {
        if (fetchedForId === id) { paymentError = '결제 정보를 불러오지 못했습니다.'; paymentLoading = false }
      })
  })

  const STATUS_LABEL: Record<string, string> = {
    pending: '접수', hold: '신청대기', confirmed: '승인완료',
    shipped: '배송중', in_use: '대여중', return_requested: '반납요청',
    returned: '반납완료', completed: '완료', cancelled: '취소', damage_claimed: '파손신고',
  }

  const PICKUP_LABELS: Record<string, string> = {
    crazydelivery: '크레이지샷 배송',
    quick:         '당일퀵 배송',
    locker:        '무인 보관함',
    visit:         '본점 방문수령',
    epost:         '택배',
    airport:       '공항 수령',
  }

  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    card:              '신용카드',
    virtualAccount:    '가상계좌',
    transfer:          '계좌이체',
    mobilePhone:       '휴대폰 결제',
    giftCertificate:   '상품권',
    easyPay:           '간편결제',
  }

  const TERMINAL = new Set(['completed', 'cancelled', 'damage_claimed'])

  function isTerminal(s: string): boolean { return TERMINAL.has(s) }

  function nextStatus(s: string, pickupMethod?: string | null, returnMethod?: string | null): string | null {
    // 방문 수령: 어드민이 현장 확인 → shipped 단계 스킵, confirmed → in_use 직접 전환
    if (s === 'confirmed' && pickupMethod === 'visit') return 'in_use'
    // 방문 반납: 어드민이 현장 반납 확인 → return_requested 단계 스킵, in_use → returned 직접 전환
    if (s === 'in_use' && returnMethod === 'visit') return 'returned'
    const map: Record<string, string> = {
      confirmed:        'shipped',
      shipped:          'in_use',
      in_use:           'return_requested',
      return_requested: 'returned',
      returned:         'completed',
    }
    return map[s] ?? null
  }

  function nextLabel(s: string, pickupMethod?: string | null, returnMethod?: string | null): string {
    if (s === 'confirmed') {
      return pickupMethod === 'visit' ? '방문 출고 처리' : '택배 출고 처리'
    }
    if (s === 'shipped') {
      return pickupMethod === 'visit' ? '방문수령 확인' : '택배수령 확인'
    }
    if (s === 'in_use') {
      // 방문 반납: 현장 즉시 반납완료 처리 / 택배·퀵: 고객 채팅 반납접수 후 처리
      return returnMethod === 'visit' ? '방문 반납 처리' : '반납 접수'
    }
    const map: Record<string, string> = {
      return_requested: '반납 처리',
      returned:         '완료 처리',
    }
    return map[s] ?? '다음 단계'
  }

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }

  function formatDateTime(dt: string | null): string {
    if (!dt) return '-'
    return new Date(dt).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  function formatAmount(n: number | null): string {
    if (n == null) return '-'
    return n.toLocaleString('ko-KR') + '원'
  }

  function gradeLabel(g: string): string { return g?.toUpperCase() ?? '-' }

  function reservationCode(): string {
    return row.reservation_code ?? `CZ-${String(row.reservation_id).padStart(5, '0')}`
  }

  const NOTIFY_TYPE_MAP: Record<string, string> = {
    confirmed:        'shipment_notify',
    in_use:           'return_remind',
    return_requested: 'return_registration',
    returned:         'rental_complete',
  }

  let notifyType = $derived(NOTIFY_TYPE_MAP[row.status] ?? null)

  function chatNotifyLabel(type: string): string {
    const map: Record<string, string> = {
      shipment_notify:     '반출 알림 발송 💬',
      return_remind:       '반납 예정 알림 💬',
      return_registration: '반납 정보 요청 💬',
      rental_complete:     '대여 종료 알림 💬',
    }
    return map[type] ?? '알림 발송 💬'
  }
</script>

<div class="panel">
  <!-- 패널 헤더 -->
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-label">대여</span>
      <span class="panel-id">{reservationCode()}</span>
      <span class="panel-status">{STATUS_LABEL[row.status] ?? row.status}</span>
    </div>
    <button class="close-btn" onclick={onclose} aria-label="패널 닫기">✕</button>
  </div>

  <!-- 탭 -->
  <div class="panel-tabs" role="tablist">
    {#each [
      { id: 'rental',   label: '대여정보' },
      { id: 'customer', label: '고객정보' },
      { id: 'payment',  label: '결제정보' },
      { id: 'contract', label: '계약서'   },
    ] as tab}
      <button
        class="tab"
        class:tab-active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        onclick={() => activeTab = tab.id as typeof activeTab}
      >{tab.label}</button>
    {/each}
  </div>

  <!-- 탭 바디 -->
  <div class="panel-body">

    <!-- ─── Tab 1: 예약정보 ─── -->
    {#if activeTab === 'rental'}

      <!-- 대여 여정 스텝퍼 -->
      <RentalJourneyStepper status={row.status} steps={stepFilter} />

      <!-- 예약 정보 -->
      <div class="section-title">대여 정보</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">예약코드</span>
          <span class="info-value mono">{reservationCode()}</span>
        </div>
        <div class="info-row">
          <span class="info-label">현재 상태</span>
          <span class="info-value">{STATUS_LABEL[row.status] ?? row.status}</span>
        </div>
        <div class="info-row">
          <span class="info-label">신청일시</span>
          <span class="info-value">{formatDateTime(row.created_at)}</span>
        </div>
      </div>

      <!-- 상품 정보 -->
      <div class="section-title">상품 정보</div>
      <div class="info-section">
        {#if row.product_image_url}
          <div class="info-row">
            <span class="info-label">상품 이미지</span>
            <div class="info-value">
              <img
                src={row.product_image_url}
                alt={row.product_name}
                class="product-thumb"
                width="60"
                height="60"
              />
            </div>
          </div>
        {/if}
        <div class="info-row">
          <span class="info-label">상품명</span>
          <span class="info-value fw-bold">{row.product_name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">상품 코드</span>
          <span class="info-value mono">{row.product_code ?? '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">카테고리</span>
          <span class="info-value">{row.product_category ?? '-'}</span>
        </div>
      </div>

      <!-- 대여 일정 -->
      <div class="section-title">대여 일정</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">대여기간</span>
          <span class="info-value">{formatDate(row.rental_start)} ~ {formatDate(row.rental_end)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">대여일수</span>
          <span class="info-value">{row.rental_days != null ? `${row.rental_days}일` : '-'}</span>
        </div>
      </div>

      <!-- 대여 방법 -->
      <div class="section-title">대여 방법</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">수령방식</span>
          <span class="info-value">{row.pickup_method ? (PICKUP_LABELS[row.pickup_method] ?? row.pickup_method) : '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">수령 일시</span>
          <span class="info-value">{formatDate(row.rental_start)}{row.pickup_time ? ' ' + row.pickup_time : ''}</span>
        </div>
        <div class="info-row">
          <span class="info-label">반납방식</span>
          <span class="info-value">{row.return_method ? (PICKUP_LABELS[row.return_method] ?? row.return_method) : '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">반납 일시</span>
          <span class="info-value">{formatDate(row.rental_end)}{row.return_time ? ' ' + row.return_time : ''}</span>
        </div>
      </div>

      <!-- 상태 액션 버튼 -->
      <div class="action-section">
        <!-- 예약 단계: 승인하기 / 거부 — reservation 뷰 전용 -->
        {#if row.status === 'hold' && !isRentalView}
          <form
            method="POST"
            action="/cms/reservation?/approveReservation"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') { csToast.success('예약이 승인되었습니다.'); onrefresh() }
                else csToast.error('처리 중 오류가 발생했습니다.')
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <button type="submit" class="btn-primary" disabled={isSubmitting}>승인하기</button>
          </form>
          <form
            method="POST"
            action="/cms/reservation?/updateStatus"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') { csToast.success('예약이 거부되었습니다.'); onrefresh() }
                else csToast.error('처리 중 오류가 발생했습니다.')
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <input type="hidden" name="status" value="cancelled" />
            <button type="submit" class="btn-danger-sm" disabled={isSubmitting}>거부</button>
          </form>

        <!-- 대여 라이프사이클: 출고 처리 → 수령 확인 → 반납 접수/처리 → 완료 처리 -->
        {:else if nextStatus(row.status, row.pickup_method, row.return_method)}
          <form
            method="POST"
            action="/cms/reservation?/updateStatus"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') { csToast.success('상태가 변경되었습니다.'); onrefresh() }
                else csToast.error('처리 중 오류가 발생했습니다.')
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <input type="hidden" name="status" value={nextStatus(row.status, row.pickup_method, row.return_method)} />
            <button type="submit" class="btn-action" disabled={isSubmitting}>
              {nextLabel(row.status, row.pickup_method, row.return_method)}
            </button>
          </form>
        {/if}

        <!-- 예약 취소 — reservation 뷰 전용 (대여 현황에서는 별도 처리 플로우) -->
        {#if !isTerminal(row.status) && row.status !== 'hold' && !isRentalView}
          <form
            method="POST"
            action="/cms/reservation?/updateStatus"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') { csToast.success('예약이 취소되었습니다.'); onrefresh() }
                else csToast.error('처리 중 오류가 발생했습니다.')
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <input type="hidden" name="status" value="cancelled" />
            <button type="submit" class="btn-cancel" disabled={isSubmitting}>예약 취소</button>
          </form>
        {/if}
      </div>

      <!-- 채팅 알림 발송 -->
      {#if notifyType && row.status !== 'cancelled' && row.status !== 'damage_claimed'}
        <div class="notify-section">
          <form
            method="POST"
            action="/cms/rentals?/sendChatNotify"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') csToast.success('채팅 알림을 발송했습니다.')
                else csToast.error('알림 발송에 실패했습니다.')
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <input type="hidden" name="notify_type" value={notifyType} />
            <button type="submit" class="btn-notify" disabled={isSubmitting}>
              {chatNotifyLabel(notifyType)}
            </button>
          </form>
        </div>
      {/if}
    {/if}

    <!-- ─── Tab 2: 고객정보 ─── -->
    {#if activeTab === 'customer'}
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">고객명</span>
          <span class="info-value fw-bold">{row.customer_name ?? '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">이메일</span>
          <span class="info-value">{row.customer_email ?? '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">전화번호</span>
          <span class="info-value">{row.customer_phone ?? '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">멤버십 등급</span>
          <span class="info-value grade-badge grade-{row.membership_grade}">
            {gradeLabel(row.membership_grade)}
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">크레이지스코어</span>
          <div class="score-wrap">
            <span class="score-num">{row.credit_score}점</span>
            <div class="score-bar-track">
              <div class="score-bar-fill" style="width:{row.credit_score}%"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="action-section">
        <a
          href="/cms/customers?selected={row.user_id}"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-action"
        >고객 상세 보기 ↗</a>
      </div>
    {/if}

    <!-- ─── Tab 3: 결제정보 ─── -->
    {#if activeTab === 'payment'}
      <!-- 주문 정보 (상시 표시) -->
      <div class="section-title">주문 정보</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">주문번호</span>
          <span class="info-value mono">
            {paymentDetail?.toss_order_id ?? (paymentLoading ? '조회 중…' : (row.order_key ?? '-'))}
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">기본 이용요금</span>
          <span class="info-value fw-bold">{formatAmount(row.order_amount)}</span>
        </div>
        {#if row.discount_amount != null && row.discount_amount > 0}
          <div class="info-row">
            <span class="info-label">주문 할인</span>
            <span class="info-value amount-discount">-{formatAmount(row.discount_amount)}</span>
          </div>
        {/if}
        <div class="info-row">
          <span class="info-label">결제 상태</span>
          <span class="info-value">{row.payment_status ?? '-'}</span>
        </div>
      </div>

      <!-- PG 결제 정보 (lazy-fetch) -->
      <div class="section-title">PG 결제 정보</div>
      {#if paymentLoading}
        <div class="loading-box">결제 정보 조회 중...</div>
      {:else if paymentError}
        <div class="error-box">{paymentError}</div>
      {:else if !paymentDetail}
        <div class="empty-box">결제 정보가 없습니다. (결제 전 예약)</div>
      {:else}
        <div class="info-section">
          {#if paymentDetail.coupon_discount != null && paymentDetail.coupon_discount > 0}
            <div class="info-row">
              <span class="info-label">쿠폰 할인</span>
              <span class="info-value amount-discount">-{formatAmount(paymentDetail.coupon_discount)}</span>
            </div>
          {/if}
          {#if paymentDetail.point_amount != null && paymentDetail.point_amount > 0}
            <div class="info-row">
              <span class="info-label">포인트 적용</span>
              <span class="info-value amount-discount">-{formatAmount(paymentDetail.point_amount)}</span>
            </div>
          {/if}
          {#if paymentDetail.paid_amount != null}
            <div class="info-row">
              <span class="info-label">부가세 (10%)</span>
              <span class="info-value">
                {formatAmount(Math.floor(paymentDetail.paid_amount / 11))}
                <span class="info-note">포함</span>
              </span>
            </div>
          {/if}
          <div class="info-row highlight-row">
            <span class="info-label">최종 결제금액</span>
            <span class="info-value fw-bold">{formatAmount(paymentDetail.paid_amount)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">결제수단</span>
            <span class="info-value">
              {paymentDetail.payment_method
                ? (PAYMENT_METHOD_LABELS[paymentDetail.payment_method] ?? paymentDetail.payment_method)
                : '-'}
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">Toss 승인코드</span>
            <span class="info-value mono small">{paymentDetail.payment_key ?? '-'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">결제 승인시간</span>
            <span class="info-value">{formatDateTime(paymentDetail.confirmed_at)}</span>
          </div>
        </div>
      {/if}

      <div class="action-section">
        <button class="btn-action" disabled title="결제 연동 완료 후 활성화 예정">환불 처리</button>
      </div>
    {/if}

    <!-- ─── Tab 4: 계약서 ─── -->
    {#if activeTab === 'contract'}
      <RentalContractViewer
        contractId={row.contract_id}
        contractPdfUrl={row.contract_pdf_url}
        autoSignedAt={row.auto_signed_at}
        customerSignedAt={row.customer_signed_at}
        signingToken={row.signing_token}
        signingsentAt={row.signing_sent_at}
        reservationId={row.reservation_id}
        productName={row.product_name}
        productCode={row.product_code}
        productCategory={row.product_category}
        rentalStart={row.rental_start}
        rentalEnd={row.rental_end}
        orderAmount={row.order_amount}
        pickupMethod={row.pickup_method}
        pickupTime={row.pickup_time}
        returnMethod={row.return_method}
        returnTime={row.return_time}
        onrefresh={onrefresh}
      />
    {/if}

  </div>
</div>

<style>
  .panel {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
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
  .panel-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .panel-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  .panel-id {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    font-family: monospace;
  }
  .panel-status {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    background: rgba(59,47,138,0.10);
    color: var(--cs-purple);
  }
  .close-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border: none; background: none;
    cursor: pointer;
    font-size: 14px; color: var(--cs-text-mid);
    border-radius: 6px;
    transition: background 0.12s;
  }
  .close-btn:hover { background: var(--cs-surface-gray); }

  /* 탭 */
  .panel-tabs {
    display: flex;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .tab {
    flex: 1;
    padding: 10px 8px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-text-mid);
    transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .tab:hover   { color: var(--cs-purple); }
  .tab-active  { color: var(--cs-purple); border-bottom-color: var(--cs-purple); font-weight: 700; }

  /* 패널 바디 */
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 20px 20px;
    display: block;
  }
  .panel-body > * + * {
    margin-top: 10px;
  }

  /* 섹션 타이틀 */
  .section-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    padding: 4px 0 2px;
  }

  /* 정보 섹션 */
  .info-section {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }
  .info-row {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    gap: 12px;
  }
  .info-row:last-child { border-bottom: none; }
  .highlight-row { background: rgba(59,47,138,0.04); }

  .info-label {
    flex: 0 0 96px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-weight: 700;
  }
  .info-value {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  .info-note {
    font-size: 11px;
    color: var(--cs-text-light);
    margin-left: 4px;
  }
  .fw-bold { font-weight: 700; }
  .mono    { font-family: monospace; }
  .small   { font-size: 11px; word-break: break-all; }
  .amount-discount { color: var(--cs-error, #ef4444); }

  /* 상품 썸네일 */
  .product-thumb {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    display: block;
  }

  /* 로딩/에러/빈 상자 */
  .loading-box, .error-box, .empty-box {
    padding: 20px 16px;
    text-align: center;
    font: var(--text-pc-script-12);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
  }
  .loading-box { color: var(--cs-text-mid); }
  .error-box   { color: var(--cs-error, #ef4444); background: rgba(239,68,68,0.04); }
  .empty-box   { color: var(--cs-text-light); }

  /* 등급 배지 */
  .grade-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .grade-none  { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .grade-easy  { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .grade-pop   { background: rgba(59,47,138,0.10);   color: var(--cs-purple); }
  .grade-crazy { background: rgba(255,69,0,0.12);    color: var(--cs-orange); }
  .grade-admin { background: var(--cs-lilac);        color: var(--cs-purple-dark); }

  /* 스코어 */
  .score-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
  }
  .score-num { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }
  .score-bar-track {
    flex: 1;
    height: 6px;
    background: var(--cs-lilac);
    border-radius: 3px;
    overflow: hidden;
  }
  .score-bar-fill {
    height: 100%;
    background: var(--cs-purple);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  /* 액션 섹션 */
  .action-section {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  /* 버튼 */
  .btn-primary {
    display: inline-flex;
    align-items: center;
    height: 36px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    text-decoration: none;
  }
  .btn-primary:hover    { background: var(--cs-purple-hover); }
  .btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-action {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    text-decoration: none;
  }
  .btn-action:hover    { background: var(--cs-purple-hover); }
  .btn-action:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-danger-sm {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: var(--cs-error);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .btn-danger-sm:hover    { opacity: 0.85; }
  .btn-danger-sm:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-cancel {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: #FFCFCF;
    color: var(--cs-error);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .btn-cancel:hover    { opacity: 0.85; }
  .btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 채팅 알림 섹션 */
  .notify-section {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px dashed var(--cs-lilac);
  }
  .btn-notify {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: transparent;
    color: var(--cs-purple);
    border: 1px solid var(--cs-purple);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .btn-notify:hover    { background: rgba(59,47,138,0.08); }
  .btn-notify:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
