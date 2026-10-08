<script lang="ts">
  import { browser } from '$app/environment'
  import { hasExistingContractContent } from '$lib/utils/contract-content-mode'
  import { isHtmlDocument } from '$lib/types/contract-document'
  import { isContractIssueBlocked } from '$lib/utils/contractIssueGuard'
  import ContractEditorModal from '$lib/components/cms/ContractEditorModal.svelte'
  import ContractTemplatePreviewModal from '$lib/components/cms/ContractTemplatePreviewModal.svelte'
  import PdfViewer from '$lib/components/common/PdfViewer.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import { csToast } from '$lib/utils/toast'

  interface Props {
    contractId:       string | null
    contractPdfUrl:   string | null
    autoSignedAt:     string | null
    customerSignedAt: string | null
    signingToken:     string | null
    signingsentAt:    string | null
    reservationId:    number
    /** 취소(cancelled)·만료(expired) 예약은 발행·발송 버튼을 비활성화한다 */
    reservationStatus: string
    productName:      string
    productCode:      string | null
    productCategory:  string
    rentalStart:      string
    rentalEnd:        string
    orderAmount:      number | null
    pickupMethod:     string | null
    pickupTime:       string | null
    returnMethod:     string | null
    returnTime:       string | null
    onrefresh:        () => void
    /**
     * true = /cms/rentals(대여현황) 컨텍스트. 계약서 탭을 "서명완료 목록 + 보기"만
     * 가능한 읽기 전용으로 제한한다 — 양식 발행·발송·편집·삭제는 예약현황(/cms/reservation)
     * 전용으로 유지(2026-08-20 확정, service-operations.md §4 원칙과 동일하게 front/cms
     * 화면별 책임을 분리).
     */
    isRentalView?:    boolean
  }
  let {
    contractId,
    contractPdfUrl,
    autoSignedAt,
    customerSignedAt,
    signingToken,
    signingsentAt,
    reservationId,
    reservationStatus,
    productName,
    productCode,
    productCategory,
    rentalStart,
    rentalEnd,
    orderAmount,
    pickupMethod = null,
    pickupTime   = null,
    returnMethod = null,
    returnTime   = null,
    onrefresh,
    isRentalView = false,
  }: Props = $props()

  // PDF 미리보기 높이를 브라우저(상세 패널 본문) 높이에 맞춘다 — 패널 본문의 남은 세로 공간 전체를 쓰고
  // (위쪽 배너·발행 목록 높이와 아래 액션 버튼 높이를 뺀 값), 창 크기·패널 크기가 바뀌면 다시 계산한다.
  // 본문 스크롤 영역(.panel-body)을 찾지 못하면 기본 높이(360px)를 유지한다.
  const PDF_MIN_HEIGHT = 360
  let pdfWrapEl: HTMLDivElement | null = $state(null)
  let pdfHeight: number | null = $state(null)

  $effect(() => {
    const wrap = pdfWrapEl
    if (!browser || !wrap) return
    const scroller = wrap.closest<HTMLElement>('.panel-body')
    if (!scroller) return

    function fit(): void {
      if (!wrap || !scroller) return
      const top = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      const actions = (wrap.nextElementSibling as HTMLElement | null)?.offsetHeight ?? 0
      const bottomPad = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
      const GAP_TO_ACTIONS = 12 // .contract-viewer의 항목 간 간격
      const next = Math.max(PDF_MIN_HEIGHT, Math.floor(scroller.clientHeight - top - actions - GAP_TO_ACTIONS - bottomPad))
      pdfHeight = next // 같은 값이면 갱신되지 않는다
    }

    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(scroller)
    if (wrap.parentElement) ro.observe(wrap.parentElement)
    window.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
  })

  // ── 받은 PDF 진위 확인(관리자 전용) ─────────────────────────────────────────
  // 고객·제3자가 제시한 PDF를 올리면 보관 원본과 대조해 진위(파일 지문)·서명 봉인·변경 위치(쪽·바뀐 줄)를 보여준다.
  // 변경 위치는 참고 분석이며 진본 판정은 파일 지문과 서명 봉인으로만 한다. 변경 위치는 이 관리자 화면에서만 제공한다.
  interface CompareResult {
    status: 'authentic' | 'superseded' | 'modified' | 'not_found'
    archiveIntact: boolean | null
    seal: 'valid' | 'invalid' | 'unsealed' | 'unknown' | 'no_key'
    comparison: {
      recordedPages: number
      submittedPages: number
      textIdentical: boolean
      pages: { page: number; status: 'same' | 'changed' | 'added' | 'missing'; changedLines: string[]; missingLineCount: number }[]
    } | null
    comparisonNote: string | null
  }
  let compareInput: HTMLInputElement | null = $state(null)
  let comparing = $state(false)
  let compareResult: CompareResult | null = $state(null)

  const VERDICT_TEXT: Record<CompareResult['status'], string> = {
    authentic: '진본입니다 — 보관된 최종본과 한 글자도 다르지 않습니다.',
    superseded: '효력 없는 이전 본입니다 — 서명 당시 발급된 파일이지만 발행 취소·재서명으로 현재는 유효하지 않습니다.',
    modified: '진본이 아닙니다 — 보관된 최종본과 다른 파일입니다(수정·재생성·다시 저장됐을 수 있습니다).',
    not_found: '확인할 보관본이 없습니다.',
  }
  const SEAL_TEXT: Record<CompareResult['seal'], string> = {
    valid: '서명 봉인 정상',
    invalid: '서명 봉인 이상 — 보관 기록이 봉인 이후 바뀌었을 수 있습니다. 즉시 확인이 필요합니다.',
    unsealed: '서명 봉인 없음(봉인 도입 전 또는 생성 대기)',
    unknown: '서명 봉인 상태를 확인하지 못했습니다(일시 오류일 수 있어요) — 잠시 후 다시 확인해 주세요.',
    no_key: '서명 봉인 확인 불가(서버 키 설정 점검 필요)',
  }
  const PAGE_STATUS_TEXT = { same: '동일', changed: '변경됨', added: '제출 파일에만 있는 쪽', missing: '제출 파일에 없는 쪽' } as const

  // 서명 봉인 확인 — 봉인이 없으면(키 도입 전 보관본 등) 매니저 이상은 확인 후 직접 봉인할 수 있다
  let sealChecking = $state(false)
  async function checkSealStatus(): Promise<void> {
    if (!contractId) return
    sealChecking = true
    try {
      const res = await fetch(`/api/cms/contracts/${contractId}/seal`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { csToast.error(json.error ?? '봉인 확인에 실패했습니다.'); return }
      const status = json.status as CompareResult['seal']
      if (status === 'unsealed') {
        if (!confirm('이 보관본에는 서명 봉인이 없습니다. 지금 보관 파일을 확인하고 봉인할까요? (매니저 이상)')) return
        const post = await fetch(`/api/cms/contracts/${contractId}/seal`, { method: 'POST' })
        const pj = await post.json().catch(() => ({}))
        if (!post.ok) { csToast.error(pj.error ?? '봉인에 실패했습니다.'); return }
        if (pj.markerRecorded === false) csToast.warning('서명 봉인은 만들었지만 봉인 표식 기록에 실패했습니다. 개발자 확인이 필요합니다.')
        else csToast.success('서명 봉인을 만들었습니다.')
        return
      }
      if (status === 'valid') csToast.success(SEAL_TEXT.valid)
      else csToast.error(SEAL_TEXT[status])
    } catch {
      csToast.error('봉인 확인 중 오류가 발생했습니다.')
    } finally {
      sealChecking = false
    }
  }

  async function compareFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || !contractId) return
    comparing = true
    compareResult = null
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`/api/cms/contracts/${contractId}/compare-file`, { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { csToast.error(json.error ?? '진위 확인에 실패했습니다.'); return }
      compareResult = json as CompareResult
    } catch {
      csToast.error('진위 확인 중 오류가 발생했습니다.')
    } finally {
      comparing = false
    }
  }

  const PICKUP_LABELS: Record<string, string> = {
    crazydelivery: '크레이지샷 배송',
    quick:         '당일퀵 배송',
    locker:        '무인 보관함',
    visit:         '본점 방문수령',
    epost:         '택배',
  }

  let editorOpen            = $state(false)
  let editorContractId      = $state<string | null>(null)
  let previewTemplateId     = $state<string | null>(null)
  let hasIssuedContent      = $state(false)
  let issuedContractTitle   = $state<string | null>(null)
  let issuedIsHtml          = $state(false)
  let issuedCheckTick       = $state(0)
  // 2026-09-08 신규 — hasIssuedContent는 비동기 조회로 채워지는데 초기값이 false라, 조회가
  // 끝나기 전까지는 "발행 안 됨" 취급되어 이미 발행된 계약에서도 "계약서 양식 선택 편집"
  // 섹션(발행 버튼)이 잠깐 잘못 노출되는 깜빡임이 있었다(실사용 중 발견). 조회 진행 중에는
  // 두 섹션(발행 버튼 / 발행 목록) 모두 숨겨 그 틈을 없앤다.
  let contentCheckLoading  = $state(false)

  // 발행 목록: contractId 변경 또는 issuedCheckTick 갱신 시 발행 여부 재확인
  $effect(() => {
    void issuedCheckTick
    if (!browser || !contractId) {
      hasIssuedContent = false; issuedContractTitle = null; issuedIsHtml = false
      contentCheckLoading = false
      return
    }
    const cid = contractId
    let alive = true
    contentCheckLoading = true
    ;(async () => {
      try {
        const r = await fetch(`/api/cms/contracts/${cid}/content`)
        if (!r.ok) { if (alive) { hasIssuedContent = false; issuedContractTitle = null; issuedIsHtml = false }; return }
        const data = await r.json() as {
          content_blocks?: unknown
          canvas_document?: unknown
          spreadsheet_document?: unknown
          html_document?: unknown
          title?: string
        }
        if (!alive) return
        // spreadsheet 모드 계약(authoring_mode='spreadsheet')은 content_blocks가 항상 []라
        // spreadsheet_document도 함께 넘겨야 "발행된 내용 있음"으로 정확히 판별된다(2026-08-21
        // 발견 — 이 인자가 빠져있어 서명 완료된 spreadsheet 계약도 "서명완료 목록" 섹션 자체가
        // 렌더링되지 않는 결함이 있었다. contract-content-mode.ts 참고).
        // 2026-09-07 같은 클래스의 결함 추가 발견: html_document도 동일한 이유로 누락돼 있어
        // authoring_mode='html' 계약은 발행 여부와 무관하게 항상 "미발행"으로 오판됐다.
        hasIssuedContent    = hasExistingContractContent(data.content_blocks, data.canvas_document, data.spreadsheet_document, data.html_document)
        issuedContractTitle = data.title ?? null
        // html 모드는 ContractEditorModal(캔버스형 편집기)로 편집이 구조적으로 불가능해
        // "편집" 버튼 자체를 숨긴다(2026-09-08 신규 — 특약 클릭편집만 유일한 수정 경로).
        issuedIsHtml        = isHtmlDocument(data.html_document)
      } catch {
        if (alive) hasIssuedContent = false
      } finally {
        if (alive) contentCheckLoading = false
      }
    })()
    return () => { alive = false }
  })

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

  const signingUrl = $derived(
    signingToken ? `/contract/${signingToken}` : null
  )

  // 취소·만료 예약은 발행/발송 액션 자체를 막는다(대여현황의 "보기"·PDF·서명링크 열람은 무관)
  const issueBlocked = $derived(isContractIssueBlocked(reservationStatus))
  const issueBlockedLabel = $derived(
    reservationStatus === 'expired'        ? '만료된'
    : reservationStatus === 'damage_claimed' ? '파손 신고된'
    : '취소된'
  )

  // Stage 5 (EC-6): 재발송 버튼 — 기존 send-chat 엔드포인트 재사용 (sent_at 갱신 + 채팅 재발송)
  let isResending = $state(false)

  async function handleResend() {
    if (!contractId || isResending) return
    isResending = true
    try {
      const res = await fetch(`/api/cms/contracts/${contractId}/send-chat`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        csToast.error(json.error ?? '재발송에 실패했습니다.')
      } else {
        csToast.success('계약서가 재발송되었습니다.')
        onrefresh()
      }
    } catch {
      csToast.error('재발송 중 오류가 발생했습니다.')
    } finally {
      isResending = false
    }
  }
</script>

<div class="contract-viewer">
  <!-- 상태 배너 -->
  {#if issueBlocked}
    <div class="banner banner-blocked">
      {issueBlockedLabel} 예약입니다 — 계약서 발행·발송이 비활성화되었습니다
    </div>
  {/if}
  {#if customerSignedAt}
    <div class="banner banner-signed">
      고객 서명 완료 · {formatDateTime(customerSignedAt)}
    </div>
  {:else if signingsentAt}
    <div class="banner banner-sent">
      계약서 발송됨 · 서명 대기 중 ({formatDateTime(signingsentAt)})
    </div>
  {:else if contractId}
    <div class="banner banner-unsigned">
      계약서 미서명 — 고객에게 발송하세요
    </div>
  {:else}
    <div class="banner banner-none">
      계약서 미생성 — 양식을 선택해 발송하세요
    </div>
  {/if}

  <!-- 계약서 양식 목록 (예약현황 전용 — 대여현황에서는 발행 자체를 숨김).
       2026-09-08 추가: 이미 발행된 내용이 있으면(hasIssuedContent) 이 섹션도 함께 숨긴다 —
       "발행" 버튼을 비활성화만 하는 대신 완전히 감춰 중복 발행 시도 자체를 차단한다(Stephen
       지시 — 감추는 쪽이 비활성화보다 명시적). 아래 "발행 목록" 카드의 초기화(clearIssuedContract)
       ·폐기(discardSentContract)·발행취소(cancelIssuedContract) 중 어느 것으로든 콘텐츠가
       비워지면 issuedCheckTick이 올라가 hasIssuedContent가 다시 false로 재계산되므로, 이
       섹션은 별도 코드 없이 자동으로 다시 나타나 재발행이 가능해진다(대여현황과 동일한
       "발행 없음 = 섹션 노출" 패턴). -->
  {#if !isRentalView && !contentCheckLoading && !hasIssuedContent}
    <div class="tpl-section">
      <div class="tpl-section-head">
        <span class="tpl-section-title">계약서 양식 선택 편집</span>
        <button
          class="btn-issue"
          disabled={issueBlocked}
          title={issueBlocked ? `${issueBlockedLabel} 예약은 계약서를 발행할 수 없습니다.` : undefined}
          onclick={() => { previewTemplateId = '' }}
        >발행</button>
      </div>
    </div>
  {/if}

  <!-- 발행 목록: 편집된 content_blocks가 있을 때만 표시.
       RSV-C-B3: 대여현황(isRentalView) 또는 고객이 서명완료(customerSignedAt)한 경우
       → "서명완료 목록"으로 노출 + 보기(view-only)만 허용. 그 외는 편집·발송 포함 전체 기능. -->
  {#if hasIssuedContent && contractId && (!isRentalView || customerSignedAt)}
    <div class="tpl-section">
      <div class="tpl-section-head">
        <span class="tpl-section-title">{isRentalView ? '서명완료 목록' : '발행 목록'}</span>
      </div>
      <div class="tpl-list">
        <div class="tpl-card">
          <!-- 2026-09-08 수정: "발행된 계약서"라는 일반 문구 대신 이 예약의 실제 상품명(+품번)을
               명시적으로 노출 — 여러 예약을 오가며 확인할 때 어느 계약서인지 한눈에 구분되도록 함
               (Stephen 지시, 계약문서 내 상품명 표기와 동일한 정보를 카드 제목에도 노출). -->
          <span class="tpl-card-title">{productName}{productCode ? ` ${productCode}` : ''}</span>
          <div class="tpl-card-actions">
            {#if !isRentalView && !signingsentAt && !customerSignedAt && !issuedIsHtml}
              <button
                class="btn-tpl-edit"
                onclick={() => { editorOpen = true; editorContractId = contractId }}
              >
                편집
              </button>
            {/if}
            <!-- 2026-09-08 수정: 취소·만료 예약도 "발송"만 막고 "열람"은 항상 허용 —
                 이전엔 issueBlocked 예약이면 버튼 자체가 비활성화돼 이미 발행된 계약
                 내용조차 다시 볼 수 없었다(Stephen 지시로 열람 허용). 아래 모달 호출부의
                 viewOnly={isRentalView || issueBlocked}가 실제 편집·발송 기능은 계속
                 차단한다 — 이 버튼은 더 이상 disabled 처리하지 않는다. -->
            <button
              class="btn-tpl-preview"
              onclick={() => { previewTemplateId = '' }}
            >
              {isRentalView || customerSignedAt || issueBlocked ? '보기' : '미리보기 & 발송'}
            </button>
            {#if !isRentalView && !signingsentAt && !customerSignedAt}
              <span class="tpl-card-del-gap"></span>
              <CmsDeleteButton
                size="lg"
                action="?/clearIssuedContract"
                id={contractId!}
                warnMessage="한번 더 선택 시 이 계약서 내용이 초기화됩니다."
                successMessage="계약서 내용이 초기화되었습니다."
                onsuccess={() => { issuedCheckTick++ }}
              />
            {/if}
            {#if !isRentalView && signingsentAt && !customerSignedAt}
              <!-- Stage 5 (EC-6): 재발송 — 기존 서명 링크 유지, sent_at 갱신 후 채팅 재발송 -->
              <button
                class="btn-tpl-resend"
                disabled={issueBlocked || isResending}
                title={issueBlocked ? `${issueBlockedLabel} 예약은 계약서를 재발송할 수 없습니다.` : undefined}
                onclick={handleResend}
              >
                {isResending ? '발송 중...' : '재발송'}
              </button>
              <!-- 2026-09-08 이관 — 기존엔 카드 바깥 .contract-actions에 별도로 떨어져 있던
                   "서명 링크 확인" 버튼을 발행 목록 카드 액션 행 안으로 이동(레이아웃 통일감,
                   Stephen 지시). 노출 조건(signingUrl 존재 + 미서명)은 원래와 동일 — 위치만 이동. -->
              {#if signingUrl}
                <a
                  href={signingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn-tpl-resend"
                >서명 링크 확인 ↗</a>
              {/if}
              <!-- Stage 5 (EC-6): 폐기 — 서명 링크 만료 + 콘텐츠 초기화 (manager 이상 서버단 게이트) -->
              <span class="tpl-card-del-gap"></span>
              <CmsDeleteButton
                size="lg"
                action="?/discardSentContract"
                id={contractId!}
                warnMessage="한번 더 선택 시 발송된 계약서가 폐기됩니다. 고객의 서명 링크가 만료됩니다."
                successMessage="계약서가 폐기되었습니다."
                onsuccess={() => { issuedCheckTick++; onrefresh() }}
              />
            {/if}
            {#if !isRentalView && customerSignedAt}
              <!-- 2026-09-07(Stephen 확정): 전자계약 발행 취소 — 고객이 이미 서명 완료한
                   계약서도 대상. "회수처리"가 아니라 발행 자체를 취소(서명 데이터까지 초기화)
                   하는 상위 액션 — discardSentContract(미서명 발송건 전용)와 별개.
                   실행 시 대화카드는 ActionCard.svelte의 라이브 체크(contract-status)로
                   "기한 만료" 처리되고, 이 "발행 목록" 카드는 onsuccess에서 issuedCheckTick을
                   올려 hasIssuedContent가 false로 재계산되며 자동으로 사라진다. -->
              <span class="tpl-card-del-gap"></span>
              <CmsDeleteButton
                size="lg"
                action="?/cancelIssuedContract"
                id={contractId!}
                warnMessage="한번 더 선택 시 서명 완료된 전자계약 발행이 취소됩니다. 고객의 서명 내용도 함께 삭제되며 되돌릴 수 없습니다."
                successMessage="전자계약 발행이 취소되었습니다."
                onsuccess={() => { issuedCheckTick++; onrefresh() }}
              />
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- 서명 직후 최종본 PDF 생성 대기: 크론(10분 간격)이 만들기 전까지 안내만 표시한다 -->
  {#if customerSignedAt && !contractPdfUrl}
    <div class="banner banner-sent" role="status">최종본 PDF를 준비 중입니다. 서명 완료 후 보통 10분 안에 표시됩니다. 잠시 후 다시 열어 주세요.</div>
  {/if}

  <!-- PDF 미리보기·다운로드: 서명 완료 후에만 표시 -->
  {#if contractPdfUrl && customerSignedAt}
    <div class="pdf-wrap" bind:this={pdfWrapEl} style:height={pdfHeight != null ? `${pdfHeight}px` : undefined}>
      <!-- 브라우저 내장 뷰어 대신 자체 뷰어(PdfViewer) — 고객 계약서 화면과 같은 도구줄·동작 -->
      <PdfViewer
        src={contractPdfUrl}
        title={`전자계약서_${reservationId}.pdf`}
        downloadUrl={`${contractPdfUrl}${contractPdfUrl.includes('?') ? '&' : '?'}download=1`}
        downloadFilename={`crazyshot-contract-${reservationId}.pdf`}
      />
    </div>
  {/if}

  <!-- 액션 버튼 -->
  <div class="contract-actions">
    {#if contractPdfUrl && customerSignedAt}
      <a
        href={contractPdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="btn-secondary"
      >PDF 다운로드</a>
      <input type="file" accept="application/pdf" class="compare-input" bind:this={compareInput} onchange={compareFile} />
      <button type="button" class="btn-secondary" disabled={comparing} onclick={() => compareInput?.click()}>
        {comparing ? '확인 중…' : '받은 PDF 진위 확인'}
      </button>
      <button type="button" class="btn-secondary" disabled={sealChecking} onclick={checkSealStatus}>
        {sealChecking ? '확인 중…' : '서명 봉인 확인'}
      </button>
    {/if}
    <!-- 2026-09-08: "서명 링크 확인" 버튼은 "발행 목록" 카드의 액션 행 안으로 이관됐다
         (레이아웃 통일감). 여기 남아있던 원본을 지우지 않아 "발송됨+미서명" 상태에서
         동일 링크가 카드 안/밖 두 곳에 중복 렌더링되던 결함을 sp3-qa-agent가 발견 —
         이관이 아니라 복제가 돼 있었음. 이 블록에서 완전히 제거해 카드 쪽 1곳만 남김. -->
  </div>

  {#if compareResult}
    <div class="compare-box" role="status">
      <p class="compare-verdict" class:compare-bad={compareResult.status !== 'authentic'}>{VERDICT_TEXT[compareResult.status]}</p>
      <p class="compare-line" class:compare-bad={compareResult.seal === 'invalid'}>{SEAL_TEXT[compareResult.seal]}</p>
      {#if compareResult.archiveIntact === false}
        <p class="compare-line compare-bad">서버 보관 파일이 기록된 지문과 다릅니다 — 보관본 훼손이 의심됩니다.</p>
      {/if}
      {#if compareResult.comparison}
        {#if compareResult.comparison.textIdentical}
          <p class="compare-line">모든 쪽의 글자 내용이 같습니다 — 내용 변경 없이 파일만 다시 저장됐을 가능성이 높습니다(인쇄 후 PDF 저장 등).</p>
        {:else}
          <p class="compare-line">변경 위치 분석(참고용 — 보관 {compareResult.comparison.recordedPages}쪽 / 제출 {compareResult.comparison.submittedPages}쪽)</p>
          <ul class="compare-pages">
            {#each compareResult.comparison.pages.filter((p) => p.status !== 'same') as p (p.page)}
              <li>
                <strong>{p.page}쪽 · {PAGE_STATUS_TEXT[p.status]}</strong>
                {#if p.missingLineCount > 0}<span class="compare-sub"> (기록에 있던 {p.missingLineCount}줄이 제출 파일에 없음)</span>{/if}
                {#if p.changedLines.length > 0}
                  <ul>{#each p.changedLines as line, i (i)}<li>{line}</li>{/each}</ul>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      {:else if compareResult.comparisonNote}
        <p class="compare-line">{compareResult.comparisonNote}</p>
      {/if}
      <p class="compare-sub">위 변경 위치는 글자 기준 참고 분석이며, 서명·직인 그림만 바뀐 경우는 찾지 못합니다. 진위는 첫 줄의 지문 대조와 서명 봉인으로 판단합니다.</p>
    </div>
  {/if}
</div>

{#if editorOpen && (editorContractId ?? contractId)}
  <ContractEditorModal
    contractId={(editorContractId ?? contractId)!}
    {reservationId}
    onclose={() => { editorOpen = false; editorContractId = null; issuedCheckTick++; onrefresh() }}
  />
{/if}

{#if previewTemplateId !== null}
  <ContractTemplatePreviewModal
    {contractId}
    {reservationId}
    {signingsentAt}
    {customerSignedAt}
    initialTemplateId={previewTemplateId}
    viewOnly={isRentalView || issueBlocked}
    onclose={() => { previewTemplateId = null }}
    onsent={() => { previewTemplateId = null; onrefresh() }}
    onapplied={() => {
      // template 모드 특약 클릭편집으로 방금 새로 발행됐을 수 있음(2026-09-08 신규) —
      // 모달은 계속 열어둔 채(onEdit/onsent와 달리 previewTemplateId를 null로 만들지 않음)
      // "발행 목록" 표시 상태만 재확인. 위 onEdit 콜백의 issuedCheckTick++ 패턴과 동일.
      issuedCheckTick++
      onrefresh()
    }}
    onEdit={(!isRentalView && !signingsentAt && !customerSignedAt)
      ? (editedContractId) => {
          previewTemplateId = null
          editorOpen        = true
          // 미리보기 모달이 template 모드였다면 방금 적용·저장한 contractId를 전달해준다 —
          // 그 값을 쓰지 않고 예전 contractId(비어있을 수 있음)로 열면 "정보 소실"처럼
          // 보이는 버그가 재현된다(2026-08-15 실사용 중 발견, ContractTemplatePreviewModal
          // handleEditClick() 참고). existing 모드였다면 어차피 동일한 contractId가 온다.
          editorContractId  = editedContractId ?? contractId
          issuedCheckTick++ // 방금 새로 발행됐을 수 있으므로 "발행 목록" 표시 상태 재확인
        }
      : undefined}
  />
{/if}

<style>
  .contract-viewer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* 배너 */
  .banner {
    padding: 10px 14px;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .banner-signed   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
  .banner-sent     { background: rgba(14,165,233,0.12); color: var(--cs-info); }
  .banner-unsigned { background: rgba(245,158,11,0.12); color: var(--cs-warning); }
  .banner-none     { background: var(--cs-surface-gray); color: var(--cs-text-light); }
  .banner-blocked  { background: rgba(239,68,68,0.12); color: var(--cs-error); }

  /* PDF */
  .pdf-wrap {
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
    height: 360px; /* 기본값 — 패널 높이를 측정하면 style로 덮어쓴다(위 fit) */
    min-height: 360px;
  }
  /* 액션 버튼 */
  .contract-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .btn-secondary {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 14px;
    background: var(--cs-white);
    color: var(--cs-purple-dark);
    border: 1px solid var(--cs-purple-dark);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    text-decoration: none;
  }
  .btn-secondary:hover { background: rgba(59,47,138,0.06); }


  /* 받은 PDF 진위 확인(관리자) */
  .compare-input { display: none; }
  .compare-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
  }
  .compare-verdict { margin: 0; font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-success-light); }
  .compare-line { margin: 0; font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .compare-sub { margin: 0; font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .compare-bad { color: var(--cs-error); }
  .compare-pages { margin: 0; padding-left: 18px; font: var(--text-pc-script-12); color: var(--cs-text); }
  .compare-pages ul { margin: 4px 0 6px; padding-left: 16px; color: var(--cs-text-mid); }

  /* 계약서 양식 목록 */
  .tpl-section {
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }
  .tpl-section-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: var(--cs-surface-gray);
    border-bottom: 1px solid var(--cs-lilac);
  }
  .tpl-section-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .btn-issue {
    margin-left: auto;
    height: 44px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .btn-issue:hover    { background: var(--cs-purple-hover); }
  .btn-issue:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
  .tpl-list {
    display: flex;
    flex-direction: column;
  }
  .tpl-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    gap: 12px;
  }
  .tpl-card:last-child { border-bottom: none; }
  .tpl-card-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tpl-card-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .btn-tpl-edit {
    height: 28px;
    padding: 0 12px;
    background: var(--cs-white);
    color: var(--cs-purple-dark);
    border: 1px solid var(--cs-purple-dark);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .btn-tpl-edit:hover { background: rgba(59,47,138,0.06); }
  /* cms-uiux.md §0-10-G DetailPanel 전용 버튼 — 대형 (44px·퍼플 채움·15px) */
  .btn-tpl-preview {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-md);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-tpl-preview:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .btn-tpl-preview:disabled { opacity: 0.5; cursor: not-allowed; }
  /* Stage 5 (EC-6): 재발송 버튼 — 아웃라인 스타일 (편집 버튼과 동일 계열) */
  .btn-tpl-resend {
    height: 28px;
    padding: 0 12px;
    background: var(--cs-white);
    color: var(--cs-info, #0ea5e9);
    border: 1px solid var(--cs-info, #0ea5e9);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .btn-tpl-resend:hover { background: rgba(14,165,233,0.06); }
  .btn-tpl-resend:disabled { opacity: 0.5; cursor: not-allowed; }
  .tpl-card-del-gap {
    width: 8px;
    flex-shrink: 0;
  }
</style>
