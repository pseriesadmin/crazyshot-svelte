<script lang="ts">
  /**
   * ContractImportModal.svelte — 외부 문서(.docx/.xlsx) 임포트 모달
   *
   * - 파일 선택(OS 파일탐색기 트리거·크기/확장자 검증)은 호출부(ContractTemplatePanel /
   *   ContractEditorModal)에서 처리하고, 선택된 File을 initialFile prop으로 전달한다
   *   (2026-08-30 — 트리거 버튼 클릭 → 모달의 별도 "파일 선택" 클릭 2단계를 1단계로 통합)
   * - 파싱은 클라이언트에서 수행 (mammoth / SheetJS)
   * - onImport(docx/hwpx HTML)과 onImportSpreadsheet(xlsx SpreadsheetDocument)
   *   두 콜백으로 결과를 부모에게 전달
   *
   * 지원 포맷:
   *   .docx  → mammoth HTML → TipTap setContent
   *   .xlsx  → 모든 시트 → SpreadsheetDocument → 스프레드시트 에디터 모드
   *   .hwpx  → 실험 변환 → TipTap setContent
   *   .hwp   → 안내 메시지
   */

  import { csToast } from '$lib/utils/toast'
  import { importDocx } from '$lib/utils/docImport/docxImport'
  import {
    importWorkbookAsSpreadsheetDocument,
    countTotalRows,
  } from '$lib/utils/docImport/xlsxToSpreadsheetDocument'
  import { FEATURE_HWPX_EXPERIMENTAL, importHwpx } from '$lib/utils/docImport/hwpxImport'
  import type { SpreadsheetDocument } from '$lib/types/contract-document'

  // --------------------------------------------------------------------------
  // Props
  // --------------------------------------------------------------------------
  interface Props {
    /** 호출부에서 이미 선택·검증(크기/확장자)까지 마친 파일 — 모달은 이 파일을 즉시 처리한다 */
    initialFile: File
    onclose: () => void
    /** docx/hwpx → HTML 문자열 */
    onImport: (result: { type: 'html'; html: string }) => void
    /** xlsx → SpreadsheetDocument (스프레드시트 에디터 모드 전환) */
    onImportSpreadsheet?: (doc: SpreadsheetDocument) => void
  }

  let { initialFile, onclose, onImport, onImportSpreadsheet }: Props = $props()

  // --------------------------------------------------------------------------
  // 상태
  // --------------------------------------------------------------------------
  type Step =
    | 'docx-preview'
    | 'xlsx-spreadsheet-preview'    // xlsx → 모든 시트 → 스프레드시트 에디터 모드
    | 'hwp-notice'                  // P5-1: .hwp / .hwpx 기본 안내 모달
    | 'hwpx-experimental'           // P5-2: .hwpx 실험 파싱 동의 + 진행
    | 'hwpx-preview'                // P5-2: .hwpx 변환 결과 미리보기
    | 'loading'

  let step        = $state<Step>('loading')
  let selectedFile: File | null            = $state(initialFile)
  let fileType:     'docx' | 'xlsx' | 'hwp' | 'hwpx' | null = $state(null)

  // docx 상태
  let docxHtml     = $state('')
  let docxWarnings = $state<string[]>([])

  // xlsx 스프레드시트 상태
  let xlsxSpreadsheetDoc = $state<SpreadsheetDocument | null>(null)
  let xlsxTotalRows      = $state(0)

  // hwpx 실험 파싱 상태
  let hwpxHtml         = $state('')
  let hwpxWarnings     = $state<string[]>([])
  let hwpxConsentGiven = $state(false)    // 사용자 동의 체크박스

  // --------------------------------------------------------------------------
  // 파일 라우팅 — 호출부에서 이미 검증된 initialFile을 확장자별로 분기 처리
  // --------------------------------------------------------------------------
  function routeFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'docx') {
      fileType = 'docx'
      processDocx(file)
    } else if (ext === 'xlsx' || ext === 'xls') {
      fileType = 'xlsx'
      processXlsxAsSpreadsheet(file)
    } else if (ext === 'hwp') {
      // P5-1: .hwp 구 바이너리 포맷 — 파싱 시도 없이 즉시 안내 모달
      fileType = 'hwp'
      step = 'hwp-notice'
    } else if (ext === 'hwpx') {
      // P5-1 + P5-2: .hwpx — feature-flag에 따라 분기
      fileType = 'hwpx'
      if (FEATURE_HWPX_EXPERIMENTAL) {
        hwpxConsentGiven = false
        step = 'hwpx-experimental'
      } else {
        step = 'hwp-notice'
      }
    }
  }

  routeFile(initialFile)

  // --------------------------------------------------------------------------
  // docx 처리
  // --------------------------------------------------------------------------
  async function processDocx(file: File) {
    step = 'loading'
    try {
      const result = await importDocx(file)
      docxHtml     = result.html
      docxWarnings = result.warnings
      step         = 'docx-preview'
    } catch (err) {
      csToast.error(err instanceof Error ? err.message : '.docx 변환에 실패했습니다.')
      onclose()
    }
  }

  function confirmDocxImport() {
    if (!docxHtml) return
    onImport({ type: 'html', html: docxHtml })
    onclose()
  }

  // --------------------------------------------------------------------------
  // xlsx 처리 — 스프레드시트 모드 (전체 시트 임포트)
  // --------------------------------------------------------------------------
  async function processXlsxAsSpreadsheet(file: File) {
    step = 'loading'
    try {
      const doc   = await importWorkbookAsSpreadsheetDocument(file)
      const total = countTotalRows(doc)
      xlsxSpreadsheetDoc = doc
      xlsxTotalRows      = total
      if (total > 5000) {
        csToast.warning(
          `총 ${total.toLocaleString()}행이 감지됐습니다. 5,000행을 초과하면 에디터 성능이 저하될 수 있습니다.`,
        )
      }
      step = 'xlsx-spreadsheet-preview'
    } catch (err) {
      csToast.error(err instanceof Error ? err.message : '.xlsx 로드에 실패했습니다.')
      onclose()
    }
  }

  function confirmXlsxSpreadsheetImport() {
    if (!xlsxSpreadsheetDoc) return
    onImportSpreadsheet?.(xlsxSpreadsheetDoc)
    onclose()
  }

  // --------------------------------------------------------------------------
  // P5-2: HWPX 실험 파싱
  // --------------------------------------------------------------------------
  async function startHwpxExperimentalParse() {
    if (!selectedFile || !hwpxConsentGiven) return
    step = 'loading'
    try {
      const result = await importHwpx(selectedFile)
      hwpxHtml     = result.html
      hwpxWarnings = result.warnings
      step         = 'hwpx-preview'
    } catch (_err) {
      // 파싱 실패 → 기본 안내 모달로 폴백 (console 출력 금지, 사용자에게 안내 화면 제공)
      step = 'hwp-notice'
    }
  }

  function confirmHwpxImport() {
    if (!hwpxHtml) return
    onImport({ type: 'html', html: hwpxHtml })
    onclose()
  }

  // --------------------------------------------------------------------------
  // 키보드 닫기
  // --------------------------------------------------------------------------
  function trapFocus(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={trapFocus} />

<div class="cim-overlay" role="dialog" aria-modal="true" aria-label="문서 가져오기">
  <div class="cim-modal">
    <!-- 헤더 -->
    <div class="cim-header">
      <span class="cim-title">문서 가져오기</span>
      <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
    </div>

    <!-- 본문 -->
    <div class="cim-body">

      {#if step === 'loading'}
        <div class="cim-loading">변환 중...</div>

      {:else if step === 'hwp-notice'}
        <!-- P5-1: HWP / HWPX 기본 안내 모달 -->
        <div class="cim-section">
          <div class="hwp-notice-icon" aria-hidden="true">📄</div>
          <p class="cim-section-title">한글(.hwp/.hwpx) 직접 변환 안내</p>
          <p class="cim-desc">
            {#if fileType === 'hwpx'}
              선택한 <strong>.hwpx</strong> 파일은 현재 실험 변환에 실패했거나 기능이 비활성화되어 있습니다.
            {:else}
              선택한 <strong>.hwp</strong> 파일은 구형 바이너리 포맷으로 직접 변환이 지원되지 않습니다.
            {/if}
          </p>
          <div class="hwp-notice-steps">
            <p class="notice-title">아래 순서로 Word 문서로 변환 후 다시 업로드해주세요:</p>
            <ol class="notice-list">
              <li>한글(한컴오피스)에서 해당 파일을 엽니다.</li>
              <li>메뉴 <strong>파일 → 다른 이름으로 저장</strong>을 선택합니다.</li>
              <li>파일 형식을 <strong>Word 문서(.docx)</strong>로 선택합니다.</li>
              <li>저장한 .docx 파일로 다시 업로드합니다.</li>
            </ol>
          </div>
        </div>
        <div class="cim-footer">
          <button type="button" class="btn-cancel" onclick={onclose}>
            다른 파일 선택
          </button>
          <button type="button" class="btn-action" onclick={onclose}>확인</button>
        </div>

      {:else if step === 'hwpx-experimental'}
        <!-- P5-2: HWPX 실험 파싱 동의 단계 -->
        <div class="cim-section">
          <p class="cim-section-title">HWPX 실험 변환</p>
          <div class="warn-banner warn-banner--yellow">
            <strong>⚠️ 실험적 기능</strong><br />
            HWPX 파일을 HTML로 변환하는 기능은 실험 단계입니다.<br />
            복잡한 서식(표·이미지·특수 글꼴·다단 등)이 손실되거나 깨질 수 있습니다.
          </div>
          <p class="cim-desc">
            파일명: <strong>{selectedFile?.name ?? ''}</strong>
          </p>
          <div class="hwpx-notice-alt">
            <p class="notice-title">더 정확한 변환을 원한다면:</p>
            <ol class="notice-list">
              <li>한글(한컴오피스)에서 <strong>파일 → 다른 이름으로 저장</strong>.</li>
              <li>파일 형식 <strong>Word 문서(.docx)</strong> 선택 후 재업로드.</li>
            </ol>
          </div>
          <label class="hwpx-consent-label">
            <input
              type="checkbox"
              bind:checked={hwpxConsentGiven}
              aria-label="서식 손실 가능성을 이해했습니다 동의"
            />
            서식 손실 가능성을 이해했으며, 실험 변환을 진행합니다.
          </label>
        </div>
        <div class="cim-footer">
          <button type="button" class="btn-cancel" onclick={onclose}>
            다른 파일 선택
          </button>
          <button
            type="button"
            class="btn-action"
            onclick={startHwpxExperimentalParse}
            disabled={!hwpxConsentGiven}
          >
            실험 변환 시작
          </button>
        </div>

      {:else if step === 'hwpx-preview'}
        <!-- P5-2: HWPX 변환 결과 미리보기 -->
        <div class="cim-section">
          <p class="cim-section-title">HWPX 변환 결과 미리보기</p>
          {#if hwpxWarnings.length > 0}
            <div class="warn-banner">
              <strong>변환 경고:</strong>
              <ul class="warn-list">
                {#each hwpxWarnings as w}
                  <li>{w}</li>
                {/each}
              </ul>
            </div>
          {/if}
          <div class="docx-preview" aria-label="HWPX 변환 결과 미리보기">
            {@html hwpxHtml}
          </div>
        </div>
        <div class="cim-footer">
          <button type="button" class="btn-cancel" onclick={() => { step = 'hwpx-experimental' }}>다시 선택</button>
          <button type="button" class="btn-action" onclick={confirmHwpxImport}>
            이 내용으로 가져오기
          </button>
        </div>

      {:else if step === 'docx-preview'}
        <!-- docx 미리보기 -->
        <div class="cim-section">
          <p class="cim-section-title">변환 결과 미리보기</p>
          {#if docxWarnings.length > 0}
            <div class="warn-banner">
              <strong>변환 경고 ({docxWarnings.length}건):</strong>
              <ul class="warn-list">
                {#each docxWarnings.slice(0, 5) as w}
                  <li>{w}</li>
                {/each}
                {#if docxWarnings.length > 5}
                  <li>... 외 {docxWarnings.length - 5}건</li>
                {/if}
              </ul>
            </div>
          {/if}
          <div class="docx-preview" aria-label="변환된 문서 미리보기">
            {@html docxHtml}
          </div>
        </div>
        <div class="cim-footer">
          <button type="button" class="btn-cancel" onclick={onclose}>다시 선택</button>
          <button type="button" class="btn-action" onclick={confirmDocxImport}>
            이 내용으로 가져오기
          </button>
        </div>

      {:else if step === 'xlsx-spreadsheet-preview'}
        <!-- xlsx: 모든 시트를 스프레드시트 에디터로 가져오기 확인 -->
        <div class="cim-section">
          <p class="cim-section-title">스프레드시트 가져오기</p>
          {#if xlsxTotalRows > 5000}
            <div class="warn-banner warn-banner--yellow">
              <strong>⚠️ 대용량 경고</strong><br />
              총 {xlsxTotalRows.toLocaleString()}행이 감지됐습니다.
              5,000행을 초과하면 에디터 성능이 저하될 수 있습니다.
            </div>
          {/if}
          {#if xlsxSpreadsheetDoc}
            <div class="xlsx-ss-info">
              <div class="xlsx-ss-info-row">
                <span class="xlsx-ss-label">시트 수</span>
                <span class="xlsx-ss-value">{xlsxSpreadsheetDoc.sheets.length}개</span>
              </div>
              <div class="xlsx-ss-info-row">
                <span class="xlsx-ss-label">총 행 수</span>
                <span class="xlsx-ss-value">{xlsxTotalRows.toLocaleString()}행</span>
              </div>
              <div class="xlsx-ss-sheets">
                {#each xlsxSpreadsheetDoc.sheets as sheet}
                  <div class="xlsx-ss-sheet-chip">
                    {sheet.name}
                    <span class="xlsx-ss-sheet-rows">{sheet.rows.length}행</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          <p class="cim-desc">
            모든 시트가 <strong>스프레드시트 에디터</strong>로 로드됩니다.
            편집 후 저장하면 계약서에 반영됩니다.
          </p>
        </div>
        <div class="cim-footer">
          <button type="button" class="btn-cancel" onclick={onclose}>
            다시 선택
          </button>
          <button type="button" class="btn-action" onclick={confirmXlsxSpreadsheetImport}>
            스프레드시트로 가져오기
          </button>
        </div>
      {/if}

    </div>
  </div>
</div>

<style>
  .cim-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .cim-modal {
    background: var(--cs-white, #fff);
    border-radius: var(--cms-radius-sm, 8px);
    width: 100%;
    max-width: 720px;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  }

  .cim-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }
  .cim-title {
    font: var(--text-pc-title-16, 16px);
    font-weight: 700;
    color: var(--cs-text, #100B32);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 15px;
    color: var(--cs-text-mid, #666);
    padding: 4px 8px;
    border-radius: var(--radius-sm, 8px);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--cs-lilac, #ECEBF4); }

  .cim-body {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .cim-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-body-14, 14px);
    color: var(--cs-text-mid, #666);
    padding: 48px;
  }

  .cim-section {
    flex: 1;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
  }

  .cim-section-title {
    margin: 0;
    font: var(--text-pc-body-14, 14px);
    font-weight: 700;
    color: var(--cs-text, #100B32);
  }

  .cim-desc {
    margin: 0;
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text-mid, #666);
    line-height: 1.6;
  }

  .warn-banner {
    padding: 10px 14px;
    background: rgba(255, 177, 0, 0.1);
    border: 1px solid rgba(255, 177, 0, 0.4);
    border-radius: var(--cms-radius-sm, 8px);
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text, #100B32);
    line-height: 1.5;
  }
  .warn-banner--yellow {
    background: rgba(255, 140, 0, 0.08);
    border-color: rgba(255, 140, 0, 0.45);
  }
  .warn-list {
    margin: 6px 0 0;
    padding-left: 18px;
  }
  .warn-list li {
    margin-bottom: 2px;
    color: var(--cs-text-mid, #666);
  }

  /* P5-1: HWP 안내 */
  .hwp-notice-icon {
    font-size: 32px;
    text-align: center;
    line-height: 1;
  }
  .hwp-notice-steps,
  .hwpx-notice-alt {
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--cms-radius-sm, 8px);
    padding: 12px 14px;
  }
  .notice-title {
    margin: 0 0 8px;
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    color: var(--cs-text, #100B32);
  }
  .notice-list {
    margin: 0;
    padding-left: 18px;
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text, #100B32);
    line-height: 1.7;
  }
  .notice-list li { margin-bottom: 4px; }

  /* P5-2: HWPX 동의 체크박스 */
  .hwpx-consent-label {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font: var(--text-pc-body-14, 14px);
    color: var(--cs-text, #100B32);
    cursor: pointer;
    line-height: 1.5;
  }
  .hwpx-consent-label input[type="checkbox"] {
    margin-top: 2px;
    flex-shrink: 0;
    accent-color: var(--cs-purple, #3B2F8A);
  }

  /* docx 미리보기 */
  .docx-preview {
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--cms-radius-sm, 8px);
    padding: 16px;
    background: var(--cs-surface-gray, #f6f6f6);
    max-height: 360px;
    overflow-y: auto;
    font: var(--text-pc-body-14, 14px);
    color: var(--cs-text, #100B32);
    line-height: 1.7;
  }
  .docx-preview :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
  }
  .docx-preview :global(td),
  .docx-preview :global(th) {
    border: 1px solid #ddd;
    padding: 5px 8px;
  }

  /* xlsx 스프레드시트 정보 박스 */
  .xlsx-ss-info {
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--cms-radius-sm, 8px);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .xlsx-ss-info-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .xlsx-ss-label {
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    color: var(--cs-text-mid, #666);
    min-width: 60px;
  }
  .xlsx-ss-value {
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text, #100B32);
  }
  .xlsx-ss-sheets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .xlsx-ss-sheet-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-full, 99px);
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text, #100B32);
  }
  .xlsx-ss-sheet-rows {
    color: var(--cs-text-light, #aaa);
    font-size: 11px;
  }

  /* 푸터 */
  .cim-footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 14px 20px;
    border-top: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }

  .btn-action {
    height: 34px;
    padding: 0 18px;
    background: var(--cs-purple, #3B2F8A);
    color: var(--cs-white, #fff);
    border: none;
    border-radius: var(--cms-radius-sm, 8px);
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-action:hover:not(:disabled) { background: var(--cs-purple-hover, #2d2470); }
  .btn-action:disabled { background: var(--cs-disabled-button, #ccc); cursor: not-allowed; }

  .btn-cancel {
    height: 34px;
    padding: 0 14px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm, 8px);
    background: var(--cs-white, #fff);
    font: var(--text-pc-script-12, 12px);
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-cancel:hover { background: var(--cs-surface-gray, #f6f6f6); }
</style>
