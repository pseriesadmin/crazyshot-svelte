<script lang="ts">
  /**
   * ContractSpreadsheetEditor.svelte — 스프레드시트 모드 계약서 에디터 (Phase spreadsheet)
   *
   * jspreadsheet-ce(MIT)를 onMount 내부 동적 import로 로드해 SSR 번들과 고객 페이지
   * 번들에서 완전히 격리한다.
   *
   * 초기화: initialDoc(SpreadsheetDocument)의 각 시트를 sheetToWorksheetConfig()로 변환한
   * 뒤 jspreadsheet(containerEl, { tabs, toolbar, worksheets: [...] })로 초기화.
   *
   * 저장: 부모 컴포넌트가 bind:this={ref}로 ref.getSpreadsheetDocument()를 호출하면
   * (imperative pull-ref 패턴) 위젯의 현재 상태를 SpreadsheetDocument로 역변환해 반환.
   * DOM 조작은 onMount 이후에만 발생 — SSR 안전.
   */

  import { onMount, onDestroy } from 'svelte'
  import {
    sheetToWorksheetConfig,
    worksheetConfigToSheet,
    type JssWorksheetInstance,
  } from './spreadsheetWidgetAdapter'
  import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
  import {
    hasImageOverlay,
    splitCellImageOverlay,
    toImageOverlayMarker,
    DEFAULT_IMAGE_OVERLAY_WIDTH,
  } from '$lib/types/sheet-format'
  import { csToast } from '$lib/utils/toast'
  import { renderSpreadsheetToHtml } from '$lib/utils/spreadsheetRender'
  import { fitColumnWidthsToTarget } from '$lib/utils/docImport/fitColumnWidths'
  import { ensureMaterialIconsFont } from '$lib/utils/loadMaterialIconsFont'

  // ─────────────────────────────────────────────────────────────────────────────
  // Props
  // ─────────────────────────────────────────────────────────────────────────────

  interface Props {
    /** 초기 스프레드시트 문서. null이면 빈 1행1열 시트로 시작 */
    initialDoc?: SpreadsheetDocument | null
    /** 읽기전용 모드 (true면 툴바 비활성화) */
    readonly?: boolean
    /**
     * 그리드 내용이 실제로 바뀔 때(셀 값·서식·컬럼너비·병합·행/열 추가삭제·붙여넣기·
     * 되돌리기/다시하기·정렬 등) 호출되는 콜백 — 부모(ContractTemplatePanel.svelte)가
     * "수정 저장" 버튼의 활성/비활성(isDirty) 판정에 사용한다. 2026-08-28 Stephen 요청.
     */
    onchange?: () => void
  }

  let { initialDoc = null, readonly = false, onchange }: Props = $props()

  // ─────────────────────────────────────────────────────────────────────────────
  // 내부 duck-type 인터페이스 (jspreadsheet-ce 런타임 import 없이 타입 안전성 유지)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * SpreadsheetInstance의 필요한 메서드만 duck-type으로 정의.
   * worksheets는 unknown[]으로 선언해 JssWorksheetInstance 구조 호환성 검사를 분리함.
   */
  interface JssSpreadsheetParent {
    worksheets: unknown[]
    getWorksheetActive(): number
    el: HTMLElement
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 타입 가드 함수
  // ─────────────────────────────────────────────────────────────────────────────

  /** jspreadsheet SpreadsheetInstance 형태인지 런타임 확인 */
  function isSpreadsheetParent(value: unknown): value is JssSpreadsheetParent {
    if (typeof value !== 'object' || value === null) return false
    const rec = value as Record<string, unknown>
    return (
      Array.isArray(rec['worksheets']) &&
      typeof rec['getWorksheetActive'] === 'function' &&
      rec['el'] instanceof HTMLElement
    )
  }

  /**
   * 워크시트 인스턴스가 JssWorksheetInstance 메서드를 갖는지 런타임 확인.
   * unknown[] 항목을 JssWorksheetInstance로 좁혀 worksheetConfigToSheet()에 전달.
   */
  function isWorksheetLike(value: unknown): value is JssWorksheetInstance {
    if (typeof value !== 'object' || value === null) return false
    const rec = value as Record<string, unknown>
    return (
      typeof rec['getData'] === 'function' &&
      typeof rec['getMerge'] === 'function' &&
      typeof rec['getStyle'] === 'function' &&
      typeof rec['getWidth'] === 'function' &&
      typeof rec['getSelection'] === 'function' &&
      typeof rec['getValueFromCoords'] === 'function' &&
      typeof rec['setValueFromCoords'] === 'function' &&
      typeof rec['setWidth'] === 'function'
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 내부 상태
  // ─────────────────────────────────────────────────────────────────────────────

  let containerEl: HTMLDivElement | undefined = $state(undefined)
  let initialized = $state(false)
  let initError = $state<string | null>(null)

  /** jspreadsheet SpreadsheetInstance 참조 (onMount에서 설정) */
  let spreadsheetParent: JssSpreadsheetParent | null = null
  /** onDestroy 정리 함수 */
  let destroyFn: (() => void) | null = null
  /**
   * 마지막으로 선택이 발생한 워크시트 인스턴스 + 그 좌표 캐시. 변수 칩 버튼(그리드 바깥 DOM)
   * 클릭 시 그리드가 blur되며 jspreadsheet-ce의 실시간 getSelection()이 선택 정보를 잃을
   * 가능성에 대비해, `onselection`(스프레드시트 최상위 옵션 — ⚠️ WorksheetOptions가 아니라
   * SpreadsheetOptions 소속. 각 워크시트 설정에 끼워넣으면 jspreadsheet-ce가 아예 인식하지
   * 못해 호출조차 안 된다 — 2026-08-16 Stephen "삽입이 전혀 반영 안 됨" 제보의 실제 원인)로
   * 선택이 바뀔 때마다 계속 갱신해두고 insertTextAtSelection()에서 getSelection()이 무효할
   * 때 이 캐시로 폴백한다.
   */
  let lastSelectedWs: JssWorksheetInstance | null = null
  let lastSelectedCoords: [number, number] | null = null

  /**
   * 이미지 레이어 자체의 선택 상태(그리드 셀 선택과는 별개 개념 — 2026-08-16 신규).
   * renderCellValue()는 jspreadsheet 값이 바뀔 때만 다시 호출되므로, "이 이미지가 지금
   * 클릭돼 선택됐는가"는 Svelte 상태가 아니라 순수 DOM 클로저 변수로 직접 관리한다
   * (문서형 ImageWithNodeView의 isDragging 패턴과 동일 원칙). 새 이미지를 클릭하면 이전에
   * 선택돼 있던 플로팅 툴바를 먼저 숨긴다.
   */
  let activeOverlayBar: HTMLDivElement | null = null
  /** 선택된 셀 좌표 "x,y" — 드래그 커밋 등으로 renderCellValue()가 다시 호출돼 DOM이
   *  통째로 재생성돼도(위 activeOverlayBar 참조는 그때 끊김) 이 키로 "재렌더링된
   *  것도 여전히 선택된 셀"임을 판별해 플로팅 툴바를 다시 노출한다. */
  let activeOverlayCellKey: string | null = null

  /** 현재 선택된 이미지 레이어의 플로팅 툴바를 숨기고 선택 해제 상태로 되돌린다. */
  function deselectOverlayImage(): void {
    if (activeOverlayBar) activeOverlayBar.style.display = 'none'
    activeOverlayBar = null
    activeOverlayCellKey = null
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 반복 영역 상태 (Stage 3, 2026-08-28)
  // jspreadsheet-ce는 repeatRegion 개념이 없으므로 앱 레벨에서 별도 관리한다.
  // getSpreadsheetDocument() 호출 시 여기서 추적한 값을 각 SpreadsheetSheet에 주입한다.
  // ─────────────────────────────────────────────────────────────────────────────

  /** 시트 인덱스별 반복 영역 — SpreadsheetSheet.repeatRegion과 동기화 */
  let sheetRepeatRegions = $state<Array<{ startRow: number; endRow: number } | undefined>>([])

  /** 현재 활성 시트 인덱스 — onselection 콜백에서 갱신(반복 영역 버튼 표시에 사용) */
  let activeSheetIndexState = $state(0)

  /**
   * onselection에서 마지막으로 캡처한 행 범위.
   * 순수 클로저 변수(비반응성) — 버튼 클릭 시 현재 값을 한 번만 읽으면 충분하다.
   */
  let lastSelectedRowRange: { y1: number; y2: number } | null = null

  /**
   * 각 시트의 실제 <table> 엘리먼트 참조 — onMount setTimeout 내에서 wsInstances로부터 추출.
   * DOM 조작(반복 영역 시각적 밴드 적용)에 직접 사용한다.
   */
  let wsTableElements: (HTMLTableElement | null)[] = []

  /**
   * 특정 시트의 <tr> 엘리먼트에 data-cse-repeat 속성을 부여해 시각적 밴드를 표시한다.
   * jspreadsheet-ce는 셀 값 변경 시 <tr>을 재생성하지 않으므로 속성이 유지된다.
   * 행 추가/삭제(oninsertrow/ondeleterow) 시에는 reapplyRepeatRegionAllSheets()로 재적용.
   */
  function applyRepeatRegionDOM(
    sheetIndex: number,
    region: { startRow: number; endRow: number } | undefined,
  ): void {
    const tableEl = wsTableElements[sheetIndex]
    if (!tableEl) return
    const rows = tableEl.querySelectorAll<HTMLTableRowElement>('tbody > tr')
    rows.forEach((tr, idx) => {
      if (!region || idx < region.startRow || idx > region.endRow) {
        tr.removeAttribute('data-cse-repeat')
      } else {
        const isSingle = region.startRow === region.endRow
        const marker = isSingle
          ? 'only'
          : idx === region.startRow
            ? 'first'
            : idx === region.endRow
              ? 'last'
              : 'mid'
        tr.setAttribute('data-cse-repeat', marker)
      }
    })
  }

  /** 모든 시트에 현재 sheetRepeatRegions 상태를 DOM에 재적용한다(행 삽입·삭제 후 호출). */
  function reapplyRepeatRegionAllSheets(): void {
    sheetRepeatRegions.forEach((region, i) => {
      applyRepeatRegionDOM(i, region)
    })
  }

  /**
   * "반복 영역으로 지정" / "반복 해제" 토글.
   * onselection에서 캡처한 lastSelectedRowRange를 현재 활성 시트의 repeatRegion으로 설정하거나,
   * 동일 범위를 다시 클릭하면 해제한다.
   */
  function toggleRepeatRegion(): void {
    if (!spreadsheetParent) {
      csToast.error('스프레드시트가 아직 준비되지 않았습니다.')
      return
    }
    if (!lastSelectedRowRange) {
      csToast.error('먼저 반복할 행 범위를 드래그로 선택하세요.')
      return
    }

    const sheetIndex = spreadsheetParent.getWorksheetActive()
    const startRow = Math.min(lastSelectedRowRange.y1, lastSelectedRowRange.y2)
    const endRow   = Math.max(lastSelectedRowRange.y1, lastSelectedRowRange.y2)
    const current  = sheetRepeatRegions[sheetIndex]

    if (current && current.startRow === startRow && current.endRow === endRow) {
      // 동일 범위 재클릭 → 해제
      sheetRepeatRegions[sheetIndex] = undefined
      applyRepeatRegionDOM(sheetIndex, undefined)
      csToast.success('반복 영역 지정을 해제했습니다.')
    } else {
      // 새 범위 지정
      const newRegion = { startRow, endRow }
      sheetRepeatRegions[sheetIndex] = newRegion
      applyRepeatRegionDOM(sheetIndex, newRegion)
      csToast.success(`${startRow + 1}~${endRow + 1}행을 반복 영역으로 지정했습니다.`)
    }
    onchange?.()
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 서명/직인 자산 삽입 팝오버 (2026-08-16 — ContractDocumentEditor.svelte의 동일 기능과
  // 같은 GET /api/cms/signature-assets 재사용, UI 패턴도 동일하게 맞춤)
  // ─────────────────────────────────────────────────────────────────────────────

  interface SigAsset {
    id: string
    asset_type: string
    image_url: string
    label: string | null
    is_default: boolean
  }

  let showSigPicker = $state(false)
  let sigAssets     = $state<SigAsset[]>([])
  let sigLoading    = $state(false)

  async function openSigPicker() {
    if (showSigPicker) {
      showSigPicker = false
      return
    }
    showSigPicker = true
    sigLoading = true
    try {
      const res = await fetch('/api/cms/signature-assets')
      sigAssets = res.ok ? (await res.json() as SigAsset[]) : []
    } catch {
      sigAssets = []
    } finally {
      sigLoading = false
    }
  }

  function insertSigAsset(asset: SigAsset) {
    const ok = insertImageAtSelection(asset.image_url, DEFAULT_IMAGE_OVERLAY_WIDTH)
    showSigPicker = false
    if (!ok) csToast.error('삽입할 셀을 먼저 선택해주세요.')
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // A4 용지 맞춤 보조도구 (2026-08-16, 2026-08-27 동작 범위 정정)
  //
  // A4 폭(642px) 자동축소는 xlsx 최초 가져오기 시점(xlsxImport.ts parseSheet)에만 1회
  // 적용된다 — sheetToWorksheetConfig()는 더 이상 로드할 때마다 재계산하지 않는다(과거엔
  // 매 로드마다 재계산해, 관리자가 A4 폭보다 넓게 직접 조정해 저장한 값이 재오픈할 때마다
  // 조용히 되돌아가는 문제가 있었음 — 2026-08-27 실사용 중 발견). 이 버튼은 관리자가
  // 필요할 때 수동으로 현재 활성 시트의 실제 컬럼너비를 다시 읽어 동일한
  // fitColumnWidthsToTarget() 함수(고객 화면 렌더러 spreadsheetRender.ts와 동일 기준)로
  // 재계산한 뒤 ws.setWidth()로 그리드에 즉시 반영한다 — "지금 보이는 그대로"가 곧
  // A4 출력 결과와 일치하도록 보장. 자동으로는 실행되지 않으며 저장 시에도 호출되지
  // 않는다(관리자가 A4보다 넓은 표를 의도적으로 유지하고 싶을 수 있으므로).
  // ─────────────────────────────────────────────────────────────────────────────

  function fitColumnsToA4(): void {
    if (!spreadsheetParent) return
    const activeIndex = spreadsheetParent.getWorksheetActive()
    const ws = spreadsheetParent.worksheets[activeIndex]
    if (!isWorksheetLike(ws)) return

    const rawWidths = ws.getWidth()
    const widths: (number | null)[] = rawWidths.map((w) => {
      if (typeof w === 'number') return w > 0 ? w : null
      const n = parseInt(w, 10)
      return !isNaN(n) && n > 0 ? n : null
    })
    const fitted = fitColumnWidthsToTarget(widths)

    let changed = false
    fitted.forEach((w, i) => {
      if (typeof w === 'number' && w !== widths[i]) {
        ws.setWidth(i, w)
        changed = true
      }
    })
    if (changed) csToast.success('컬럼 너비를 A4 용지 폭에 맞췄습니다.')
    else csToast.info('이미 A4 용지 폭 안에 있습니다.')
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // A4 출력 (2026-08-16)
  //
  // 그리드 원본(툴바·행렬 헤더·선택 하이라이트 포함)을 그대로 인쇄하면 고객이 실제로 보는
  // 결과와 다르고 지저분하다. 대신 고객 서명화면(/contract/[token])·발송 전 미리보기가
  // 이미 쓰고 있는 동일한 renderSpreadsheetToHtml()(spreadsheetRender.ts, 42개 테스트로
  // 검증된 순수 함수)로 현재 편집 상태를 HTML로 변환해 새 창에 띄우고 인쇄한다 — 인쇄
  // 미리보기가 곧 고객이 보게 될 화면과 100% 동일한 마크업이 되도록 보장.
  // ─────────────────────────────────────────────────────────────────────────────

  const PRINT_CSS = `
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20mm; font-family: -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif; }
    .ss-sheet-page { margin-bottom: 24px; }
    .ss-sheet-name { font-size: 13px; font-weight: 700; color: #100B32; margin: 0 0 8px; }
    .ss-table { border-collapse: collapse; font-size: 12px; color: #100B32; width: 100%; }
    .ss-table td { border: 1px solid #ccc; padding: 4px 6px; white-space: pre-wrap; vertical-align: top; word-break: break-all; }
    .ss-cell-image { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: 600px; height: auto; z-index: 5; }
    @page { size: A4; margin: 20mm; }
    @media print { body { padding: 0; } }
  `

  function printAsA4(): void {
    const doc = getSpreadsheetDocument()
    const html = renderSpreadsheetToHtml(doc)
    const win = window.open('', '_blank', 'noopener,noreferrer')
    if (!win) {
      csToast.error('팝업이 차단됐습니다. 팝업 허용 후 다시 시도하세요.')
      return
    }

    // DOM API로 직접 구성(문자열 결합으로 스타일·스크립트 태그 마크업을 만들지 않음) —
    // Svelte 컴파일러가 이 파일의 script 블록 내부를 스캔하다가 문자열 리터럴에 우연히
    // 포함된 스타일 태그 여는/닫는 토큰을 실제 최상위 스타일 블록 시작으로 오인해 CSS
    // 파싱 오류를 내는 사례가 실제로 발생했다(2026-08-16, svelte-check로 발견) —
    // document.write()로 해당 태그 문자열을 조립하던 이전 버전에서 재현됨.
    win.document.title = '계약서 A4 출력'
    const metaEl = win.document.createElement('meta')
    metaEl.setAttribute('charset', 'utf-8')
    win.document.head.appendChild(metaEl)
    const styleEl = win.document.createElement('style')
    styleEl.textContent = PRINT_CSS
    win.document.head.appendChild(styleEl)
    win.document.body.innerHTML = html

    // about:blank로 연 창은 이미 로드가 끝난 상태라 onload가 다시 발생하지 않을 수 있다 —
    // 서명/직인 <img> 각각의 로드 완료를 직접 기다린 뒤 인쇄한다(빈 칸 인쇄 방지).
    const imgs = Array.from(win.document.images)
    if (imgs.length === 0) {
      win.focus()
      win.print()
      return
    }
    let remaining = imgs.length
    const proceedWhenReady = () => {
      remaining -= 1
      if (remaining <= 0) {
        win.focus()
        win.print()
      }
    }
    imgs.forEach((img) => {
      if (img.complete) proceedWhenReady()
      else {
        img.addEventListener('load', proceedWhenReady)
        img.addEventListener('error', proceedWhenReady)
      }
    })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 헬퍼 함수
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * <link rel="stylesheet" href={url}>를 idempotent하게 주입한다(marker 속성으로 중복 방지).
   * `await import('some-package/foo.css')`(side-effect 스타일 동적 import)는 Vite 개발서버가
   * node_modules 안쪽 CSS를 재요청 시점에 못 찾아 "Failed to fetch dynamically imported
   * module" 오류를 내는 경우가 있음(2026-08-16 Stephen 실사용 중 발견 — jsuites.css 로딩
   * 실패로 스프레드시트 에디터 자체가 열리지 않던 문제). `?url` 임포트로 정적 리졸브된 실제
   * 에셋 URL 문자열만 받아 `<link>`로 직접 로드하면 이 문제를 피할 수 있다
   * (`pdfRasterize.ts`의 `pdf.worker.min.mjs?url` 패턴과 동일 원칙 — 버전 안전).
   */
  function injectStylesheet(url: string, markerKey: string): void {
    if (document.querySelector(`link[data-cse-style="${markerKey}"]`)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.setAttribute('data-cse-style', markerKey)
    document.head.appendChild(link)
  }

  /**
   * jspreadsheet-ce/jsuites CSS를 ?url 임포트(정적 리졸브 URL 문자열)로 가져와 <link>로 주입.
   * jsuites → jspreadsheet 순서 중요(후자가 전자를 상속/오버라이드).
   */
  async function ensureSpreadsheetCss(): Promise<void> {
    const [{ default: jsuitesCssUrl }, { default: jspreadsheetCssUrl }] = await Promise.all([
      import('jsuites/dist/jsuites.css?url'),
      import('jspreadsheet-ce/dist/jspreadsheet.css?url'),
    ])
    injectStylesheet(jsuitesCssUrl, 'jsuites')
    injectStylesheet(jspreadsheetCssUrl, 'jspreadsheet')
  }


  /** 초기 빈 문서 (initialDoc가 null일 때) */
  function emptyDoc(): SpreadsheetDocument {
    return {
      sheets: [
        {
          name: 'Sheet1',
          rows: [['', '']],
          merges: [],
          colWidths: [null, null],
          cellFormatting: [[{}, {}]],
        },
      ],
      activeSheetIndex: 0,
    }
  }

  /** 빈 시트 기본값 (워크시트 인스턴스가 없을 때 폴백) */
  function emptySheet(name: string): SpreadsheetSheet {
    return { name, rows: [], merges: [], colWidths: [], cellFormatting: [] }
  }

  /**
   * 이미지 레이어 플로팅 툴바 빌더 헬퍼(2026-08-16) — ContractDocumentEditor.svelte의
   * ImageWithNodeView 플로팅 툴바(mkBtn/mkSep)와 동일한 순수 DOM 구현·동일 스타일을
   * 그대로 이식한 것 — "워드 모드와 같은 크기조절바 UI" Stephen 요청에 맞춰 픽셀 단위로
   * 통일. jspreadsheet-ce가 셀을 재렌더링할 때마다 renderCellValue() 전체가 다시 실행돼
   * 이 헬퍼도 매번 다시 호출되지만, 버튼 1~5개 수준의 DOM 생성 비용은 무시할 만하다.
   */
  function mkOverlayToolbarBtn(text: string, title: string): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.title = title
    b.style.cssText =
      'min-height:24px;min-width:24px;padding:2px 7px;background:transparent;' +
      'border:1px solid transparent;border-radius:6px;font-size:11px;' +
      'font-weight:600;color:#100B32;cursor:pointer;line-height:1.4;flex-shrink:0'
    b.addEventListener('mouseenter', () => { b.style.background = '#ECEBF4' })
    b.addEventListener('mouseleave', () => { b.style.background = 'transparent' })
    return b
  }

  function mkOverlayToolbarSep(): HTMLSpanElement {
    const s = document.createElement('span')
    s.style.cssText = 'width:1px;height:16px;background:#ECEBF4;flex-shrink:0;align-self:center'
    return s
  }

  /**
   * jspreadsheet-ce 컬럼 render 훅 — 셀 값에 이미지 오버레이 마커가 있으면 원래 텍스트는
   * 그대로 두고 그 위에 <img>를 절대위치로 겹쳐 그린다(도장을 인쇄된 텍스트 위에 찍는 개념
   * — 셀 전체를 이미지로 교체하지 않음, 2026-08-16 Stephen 피드백으로 오버레이 방식 확정).
   * jspreadsheet-ce는 컬럼 type='image'일 때만(그리고 값이 "data:image" base64일 때만)
   * 내장 이미지 렌더링을 하는데, 우리 서명/직인 자산은 Storage의 실제 URL(image_url)이라
   * 이 render 훅으로 직접 처리한다(BaseColumn.render — jspreadsheet가 기본 렌더링을 마친
   * <td> 엘리먼트를 넘겨주는 "이후 수정" 훅, 전체 렌더링을 대체하는 게 아님). 값 자체
   * (options.data)는 마커가 붙은 텍스트 그대로라 getData()/저장에는 영향 없다 — DOM
   * 표시만 바뀐다.
   *
   * ⚠️ 2026-08-16 재발견: 크기설정 바로 이미지를 키워도(width 스타일 값은 정확히 반영됨)
   * 여전히 셀 경계에서 잘려 보이던 진짜 원인 — jspreadsheet-ce는 워크시트 옵션에
   * `textOverflow`를 켜지 않으면(우리는 켠 적 없음) 테이블 전체에 `jss_overflow` 클래스를
   * 자동으로 붙이고, `jspreadsheet.css`의 `.jss_overflow > tbody > tr > td { overflow:
   * hidden }` 규칙이 모든 셀에 적용된다(`node_modules/jspreadsheet-ce/dist/index.js`
   * 압축 소스에서 `e.options.textOverflow||e.table.classList.add("jss_overflow")` 직접
   * 확인). 이 규칙이 셀 경계를 넘어서는 절대위치 이미지를 강제로 클리핑하고 있었음 —
   * 워크시트 전체의 textOverflow 옵션을 켜면(다른 셀들의 긴 텍스트 넘침 처리가 전부
   * 달라져 부작용 큼) 대신, 오버레이가 있는 이 셀에만 인라인 overflow:visible을 부여해
   * (인라인 스타일이 클래스 선택자보다 우선순위 높음) 국소적으로 무력화한다.
   *
   * ⚠️ 두 번째 함정: jspreadsheet.css에는 `.jss_worksheet > tbody > tr > td > img {
   * max-width:100px }` 전역 기본 규칙도 있어(td 바로 아래 img 전체에 무조건 적용),
   * 셀 안 이미지를 100px로 다시 눌러버린다. CSS 클래스 특이성 계산상 우리
   * `.cse-cell-image` 규칙(클래스 3개)이 이 규칙(클래스 1개+타입 4개)보다는 이겨야
   * 정상이지만, 특이성 계산에 의존하지 않고 확실하게 이기도록 max-width도 width와
   * 함께 인라인으로 직접 지정한다(인라인 스타일은 !important 없는 외부 스타일시트
   * 규칙을 항상 이긴다 — 특이성 논쟁 자체를 없앰).
   *
   * ⚠️ 세 번째 개선(2026-08-16, 이미지 선택/이동/삭제): 이미지에 `pointer-events:none`을
   * 줬던 이전 버전은 클릭이 전부 셀로 그대로 통과해 "이미지 자체를 선택"하는 게 원천적으로
   * 불가능했다(Stephen "선택과 이동 삭제 모두 불가능" 제보). 이미지를 자체 pointer-events를
   * 가진 래퍼 `<div class="cse-cell-image-wrap">`로 감싸 클릭 가능한 레이어로 만들고,
   * 드래그(pointerdown→move→up)로 셀 중앙 기준 오프셋을 옮길 수 있게 했다. 드래그/삭제
   * 커밋은 render 콜백이 직접 받는 `instance`(워크시트)·`x`·`y` 인자를 그대로 써서
   * `resolveActiveCell()`(그리드 선택 기준)에 의존하지 않는다 — 이미지 레이어의 선택은
   * 그리드 셀 선택과 별개 개념이라서다.
   *
   * ⚠️ 네 번째 개선(2026-08-16, 크기조절바+이미지 셋트화): 클릭(선택) 시 코너에 삭제
   * 버튼만 뜨던 이전 버전은 이미지 자체를 눌러 선택하면 크기를 조절할 방법이 없었다
   * (상단 고정 툴바의 크기조절 UI는 "셀"을 선택했을 때만 반응 — 이미지를 직접 클릭하면
   * 그리드 셀선택 자체를 의도적으로 막아뒀기 때문, Stephen "이동삭제 가능하나 크기 조절
   * 불가능" 제보). ContractDocumentEditor.svelte의 ImageWithNodeView 플로팅 툴바와 동일한
   * 세트(크기 프리셋 소/중/대 + 너비입력 + 삭제)를 이미지 바로 위에 뜨는 플로팅 툴바로
   * 구현 — wrap의 자식이라 드래그 시 이미지와 함께 이동한다("워드 모드와 같은 셋트").
   */
  function renderCellValue(
    cell: HTMLTableCellElement,
    value: unknown,
    x: number,
    y: number,
    instance: unknown,
  ): void {
    if (!hasImageOverlay(value)) return
    const { text, imageUrl, width, offsetX, offsetY } = splitCellImageOverlay(value)
    if (!imageUrl) return
    if (!isWorksheetLike(instance)) return
    const ws = instance
    const cellKey = `${x},${y}`

    cell.textContent = text
    cell.style.position = 'relative'
    cell.style.overflow = 'visible'

    // ── 이미지 레이어 래퍼(선택·드래그 대상) ──
    const wrap = document.createElement('div')
    wrap.className = 'cse-cell-image-wrap'
    wrap.style.position = 'absolute'
    wrap.style.top = '50%'
    wrap.style.left = '50%'
    wrap.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`
    wrap.style.zIndex = '5'

    const img = document.createElement('img')
    img.src = imageUrl
    img.alt = '서명/직인'
    img.className = 'cse-cell-image'
    img.style.width = `${width}px`
    img.style.maxWidth = 'none'
    img.draggable = false

    // ── 플로팅 툴바(선택 시에만 노출) — ContractDocumentEditor.svelte의 ImageWithNodeView
    // 플로팅 툴바와 동일한 세트(크기 프리셋+너비입력+삭제)를 그대로 이식. wrap의 자식이라
    // 드래그로 이미지가 이동하면 툴바도 함께 이동한다("워드 모드와 같이 크기조절바 UI가
    // 직인 UI와 셋트로 생성·이동" — Stephen 2026-08-16 요청. 이전 버전은 삭제 버튼만
    // 이미지 코너에 떠 있어 이미지 자체를 눌러 선택했을 때 크기조절 수단이 없었음).
    const bar = document.createElement('div')
    bar.style.cssText =
      'display:none;position:absolute;bottom:calc(100% + 4px);left:50%;' +
      'transform:translateX(-50%);background:#fff;border:1px solid #ECEBF4;' +
      'border-radius:8px;box-shadow:0 4px 16px rgba(16,11,50,.12);' +
      'padding:4px 8px;gap:4px;align-items:center;white-space:nowrap;z-index:10'

    /** 셀 값의 오버레이 마커에서 너비만 교체 — 위치(offsetX/offsetY)는 그대로 보존 */
    function applyOverlayWidth(newWidth: number): void {
      const raw = ws.getValueFromCoords(x, y)
      const current = raw == null ? '' : String(raw)
      const { text: baseText, imageUrl: curUrl, offsetX: curOffsetX, offsetY: curOffsetY } =
        splitCellImageOverlay(current)
      if (!curUrl) return
      ws.setValueFromCoords(
        x, y,
        baseText + toImageOverlayMarker(curUrl, newWidth, curOffsetX, curOffsetY),
      )
    }

    const overlayPresets = [
      { label: '소', px: 100 },
      { label: '중', px: 200 },
      { label: '대', px: 400 },
    ] as const

    overlayPresets.forEach(({ label, px }) => {
      const btn = mkOverlayToolbarBtn(`${label}(${px})`, `너비 ${px}px`)
      btn.addEventListener('pointerdown', (e) => { e.stopPropagation() })
      btn.addEventListener('click', (e) => { e.stopPropagation(); applyOverlayWidth(px) })
      bar.appendChild(btn)
    })

    bar.appendChild(mkOverlayToolbarSep())

    const widthInput = document.createElement('input')
    widthInput.type = 'number'
    widthInput.min = '20'
    widthInput.max = '1200'
    widthInput.placeholder = 'px'
    widthInput.value = String(width)
    widthInput.style.cssText =
      'width:56px;height:24px;padding:0 4px;border:1px solid #ECEBF4;' +
      'border-radius:6px;font-size:11px;color:#100B32;outline:none;box-sizing:border-box;flex-shrink:0'
    widthInput.addEventListener('pointerdown', (e) => { e.stopPropagation() })
    widthInput.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        const w = parseInt(widthInput.value, 10)
        if (w > 0) applyOverlayWidth(w)
      }
    })
    widthInput.addEventListener('blur', () => {
      const w = parseInt(widthInput.value, 10)
      if (w > 0) applyOverlayWidth(w)
    })
    bar.appendChild(widthInput)

    bar.appendChild(mkOverlayToolbarSep())

    const deleteBtn = mkOverlayToolbarBtn('✕', '이미지 삭제')
    deleteBtn.style.color = '#FF3535'
    deleteBtn.addEventListener('pointerdown', (e) => { e.stopPropagation() })
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const raw = ws.getValueFromCoords(x, y)
      const current = raw == null ? '' : String(raw)
      const { text: baseText, imageUrl: stillThere } = splitCellImageOverlay(current)
      if (!stillThere) return
      ws.setValueFromCoords(x, y, baseText)
      deselectOverlayImage()
      csToast.success('서명/직인 이미지를 삭제했습니다.')
    })
    bar.appendChild(deleteBtn)

    wrap.appendChild(img)
    wrap.appendChild(bar)
    cell.appendChild(wrap)

    function selectThisOverlay(): void {
      if (activeOverlayBar && activeOverlayBar !== bar) {
        activeOverlayBar.style.display = 'none'
      }
      bar.style.display = 'flex'
      activeOverlayBar = bar
      activeOverlayCellKey = cellKey
    }

    // 드래그 이동 커밋(값 변경) 후에는 jspreadsheet가 이 render 콜백을 다시 호출해 위 DOM을
    // 통째로 새로 만든다 — 새로 만들어진 툴바 참조로 선택 상태를 이어받는다.
    if (activeOverlayCellKey === cellKey) selectThisOverlay()

    wrap.addEventListener('pointerdown', (e: PointerEvent) => {
      if (bar.contains(e.target as Node)) {
        // 툴바 클릭은 드래그 무시(문서형과 동일 원칙) — 단, 여기서도 preventDefault/
        // stopPropagation을 반드시 호출해야 한다. 이전에는 이 분기가 조용히 return만 해서
        // pointerdown이 그대로(그리고 브라우저가 자동 합성하는 호환 mousedown까지) 버블링을
        // 계속했고, jspreadsheet 자체의 그리드 셀선택/드래그 리스너가 이를 그대로 받아
        // 클릭이 버튼의 click 이벤트로 이어지기 전에 그리드가 셀을 재선택·드래그로 가로채는
        // 결함이 있었다("직인이 이동만 되고 사이즈설정바가 작동하지 않아" 실사용 재현,
        // 2026-08-19). 아래 분기에서도 동일하게 억제해 툴바 클릭이 그리드로 새어나가지
        // 않게 한다.
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // preventDefault로 jspreadsheet의 호환 mousedown 이벤트 발생 자체를 억제하고
      // stopPropagation으로 버블링도 막아 그리드 자체 셀선택/드래그와 완전히 분리한다.
      e.preventDefault()
      e.stopPropagation()
      selectThisOverlay()

      wrap.setPointerCapture(e.pointerId)
      const startClientX = e.clientX
      const startClientY = e.clientY
      let dragMoved = false

      function onMove(ev: PointerEvent): void {
        dragMoved = true
        const dx = ev.clientX - startClientX
        const dy = ev.clientY - startClientY
        wrap.style.transform = `translate(calc(-50% + ${offsetX + dx}px), calc(-50% + ${offsetY + dy}px))`
      }

      function onUp(ev: PointerEvent): void {
        wrap.removeEventListener('pointermove', onMove)
        wrap.removeEventListener('pointerup', onUp)
        wrap.removeEventListener('pointercancel', onUp)
        if (!dragMoved) return
        const dx = Math.round(ev.clientX - startClientX)
        const dy = Math.round(ev.clientY - startClientY)
        const raw = ws.getValueFromCoords(x, y)
        const current = raw == null ? '' : String(raw)
        const { text: baseText, imageUrl: curUrl, width: curWidth } = splitCellImageOverlay(current)
        if (!curUrl) return
        ws.setValueFromCoords(
          x, y,
          baseText + toImageOverlayMarker(curUrl, curWidth, offsetX + dx, offsetY + dy),
        )
      }

      wrap.addEventListener('pointermove', onMove)
      wrap.addEventListener('pointerup', onUp)
      wrap.addEventListener('pointercancel', onUp)
    })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Imperative pull-ref API
  // 부모 컴포넌트: bind:this={spreadsheetEditorRef} 후 spreadsheetEditorRef.getSpreadsheetDocument()
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 현재 편집 상태를 SpreadsheetDocument로 반환한다.
   * jspreadsheet-ce 위젯 초기화 전(또는 실패 시)에는 initialDoc 또는 emptyDoc()를 반환.
   */
  export function getSpreadsheetDocument(): SpreadsheetDocument {
    if (!spreadsheetParent) {
      return initialDoc ?? emptyDoc()
    }

    const activeSheetIndex = spreadsheetParent.getWorksheetActive()
    const sheets: SpreadsheetSheet[] = spreadsheetParent.worksheets.map((ws, i) => {
      const name = initialDoc?.sheets[i]?.name ?? `Sheet${i + 1}`
      if (!isWorksheetLike(ws)) {
        // 위젯 인스턴스를 읽지 못하면 initialDoc 해당 시트로 폴백
        return initialDoc?.sheets[i] ?? emptySheet(name)
      }
      const sheet = worksheetConfigToSheet(name, ws)
      // repeatRegion은 jspreadsheet-ce가 알지 못하므로 별도 Svelte 상태에서 주입한다
      const repeatRegion = sheetRepeatRegions[i]
      if (repeatRegion !== undefined) sheet.repeatRegion = repeatRegion
      return sheet
    })

    return { sheets, activeSheetIndex }
  }

  /**
   * 현재 활성 시트에서 실제로 삽입 가능한 셀 좌표를 확정한다(text/image 삽입 공용).
   * jspreadsheet-ce는 사용자가 아직 한 번도 셀을 클릭하지 않은 상태에서는 selectedCell이
   * undefined/null이거나 getSelection()이 좌표 없는 값을 반환할 수 있다(공식 타입정의 확인).
   * 또한 칩/버튼은 그리드 바깥 DOM이라 클릭 시 그리드가 blur되어 실시간 getSelection()이
   * 선택 정보를 잃을 가능성도 있다 — 이 경우 onselection 이벤트로 계속 갱신해둔
   * lastSelectedWs/lastSelectedCoords 캐시로 폴백한다. 둘 다 무효하면 null 반환 — 호출부가
   * "셀을 먼저 선택해주세요" 안내를 띄우고 잘못된 좌표에 조용히 쓰는 것을 방지한다.
   */
  function resolveActiveCell(): { ws: JssWorksheetInstance; x: number; y: number } | null {
    if (!spreadsheetParent) return null
    const activeIndex = spreadsheetParent.getWorksheetActive()
    const ws = spreadsheetParent.worksheets[activeIndex]
    if (!isWorksheetLike(ws)) return null

    const selection = ws.getSelection()
    let x: number | undefined
    let y: number | undefined
    if (Array.isArray(selection) && selection.length >= 2 &&
        typeof selection[0] === 'number' && typeof selection[1] === 'number' &&
        selection[0] >= 0 && selection[1] >= 0) {
      [x, y] = selection
    } else if (lastSelectedWs === ws && lastSelectedCoords) {
      [x, y] = lastSelectedCoords
    }
    if (x === undefined || y === undefined) return null
    return { ws, x, y }
  }

  /**
   * 현재 활성 시트의 선택된 셀(좌상단)에 텍스트를 삽입한다(기존 값 뒤에 이어붙임).
   * ContractFieldPanel의 변수 칩 클릭 → {{변수명}} 삽입에 사용(V2, 2026-08-16).
   * jspreadsheet-ce는 "커서 위치" 개념이 없어 TipTap의 insertMergeField와 달리
   * "현재 선택된 셀 전체"를 대상으로 한다 — 텍스트 셀 안 특정 위치 삽입은 지원하지 않음.
   * 위젯 미초기화 또는 선택 정보를 읽을 수 없으면 false를 반환하고 아무 것도 하지 않는다.
   */
  export function insertTextAtSelection(text: string): boolean {
    const target = resolveActiveCell()
    if (!target) return false
    const { ws, x, y } = target

    const current = ws.getValueFromCoords(x, y)
    const currentText = current == null ? '' : String(current)
    ws.setValueFromCoords(x, y, currentText + text)
    return true
  }

  /**
   * 현재 활성 시트의 선택된 셀(좌상단)에 서명/직인 이미지를 오버레이로 얹는다.
   * 기존 텍스트(예: 계약서 서식에 이미 인쇄된 "(인)")는 그대로 유지하고 그 위에 이미지를
   * 겹쳐 보여준다 — 도장을 인쇄된 서명란 위에 찍는 것과 동일한 개념(2026-08-16 Stephen
   * 피드백: "레이어로 텍스트 또는 셀 위에 올라가지 않음" → 오버레이 방식으로 재설계).
   * 이미 그 셀에 이미지가 얹혀 있으면(재삽입) 기존 오버레이만 새 이미지로 교체하고 원본
   * 텍스트는 유지 — 마커가 중첩돼 쌓이는 것을 방지.
   * `imageUrl`을 sheet-format.ts의 IMAGE_CELL_PREFIX 마커로 감싸 텍스트 뒤에 이어붙여 저장 —
   * SpreadsheetSheet.rows(string[][]) 스키마 변경 없이 렌더러(이 컴포넌트의 render 콜백,
   * spreadsheetRender.ts)가 이 마커를 감지해 텍스트 위에 <img>를 겹쳐 그린다.
   */
  export function insertImageAtSelection(
    imageUrl: string,
    width: number = DEFAULT_IMAGE_OVERLAY_WIDTH,
  ): boolean {
    const target = resolveActiveCell()
    if (!target) return false
    const { ws, x, y } = target

    const current = ws.getValueFromCoords(x, y)
    const currentText = current == null ? '' : String(current)
    const { text: baseText } = splitCellImageOverlay(currentText)
    ws.setValueFromCoords(x, y, baseText + toImageOverlayMarker(imageUrl, width))
    return true
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 초기화 (onMount — SSR 번들에서 완전히 격리)
  // ─────────────────────────────────────────────────────────────────────────────

  onMount(async () => {
    if (!containerEl) return

    try {
      // CSS 먼저 주입 (jsuites → jspreadsheet 순서 중요)
      await ensureSpreadsheetCss()
      ensureMaterialIconsFont()

      // jspreadsheet-ce JS 동적 import (SSR·고객 번들 포함 금지)
      const jssModule = await import('jspreadsheet-ce')
      // Vite는 CJS "export =" 모듈을 .default로 래핑한다
      const jspreadsheet = jssModule.default

      const doc = initialDoc ?? emptyDoc()

      // 반복 영역 초기값 복원 (initialDoc에서 — Stage 3, 2026-08-28)
      sheetRepeatRegions = doc.sheets.map((s) => s.repeatRegion)

      const worksheetConfigs = doc.sheets.map((sheet) => {
        const config = sheetToWorksheetConfig(sheet)
        return {
          ...config,
          // 모든 컬럼에 이미지 셀 렌더링 훅 부여 — 어느 셀이든 서명/직인 삽입 대상이 될 수 있음
          columns: config.columns.map((col) => ({ ...col, render: renderCellValue })),
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // isDirty 변경감지 가드 (2026-08-28) — jspreadsheet(el, opts) 생성자 호출 자체가
      // worksheetConfigs의 mergeCells/style을 실제로 적용하는 과정에서 onmerge·
      // onchangestyle 등 "사용자 편집"과 동일한 이벤트를 내부적으로 재사용해 발생시킨다
      // (실측 확인 — 그리드를 열기만 했는데 "수정 저장" 버튼이 곧바로 활성화됨). 생성자
      // 호출이 끝난 뒤(다음 macrotask, 지연 렌더링까지 포함해 안전하게) 이 가드를 풀기
      // 전까지는 onchange?.()를 호출하지 않아, 초기 로드 시점의 이벤트를 "실제 사용자
      // 편집"과 구분한다.
      // ─────────────────────────────────────────────────────────────────────
      let skipChangeTracking = true
      const notifyChange = () => {
        if (!skipChangeTracking) onchange?.()
      }

      // jspreadsheet(el, opts) → WorksheetInstance[]
      // WorksheetInstance[0].parent → SpreadsheetInstance (tabs 공유 부모)
      // ⚠️ onselection은 WorksheetOptions가 아니라 최상위 SpreadsheetOptions 소속이라
      // 반드시 여기(jspreadsheet() 최상위 호출 인자)에 둬야 실제로 호출된다 — 각 워크시트
      // 설정 안에 넣으면 jspreadsheet-ce가 인식하지 못해 조용히 무시된다(2026-08-16
      // Stephen "칩을 눌러도 지정 셀에 전혀 반영 안 됨" 제보의 실제 원인).
      const wsInstances = jspreadsheet(containerEl, {
        tabs: doc.sheets.length > 1,
        // jspreadsheet-ce 기본 툴바에는 셀 병합 기능이 이미 포함돼 있으나(setMerge/removeMerge
        // 호출, 소스 확인 완료) 기본 아이콘이 "web"(지구본)이라 셀 병합 기능처럼 보이지 않는다
        // (Stephen "셀 병합 기능이 없다" 제보의 실제 원인 — 기능 부재가 아니라 아이콘
        // 오인식). 기본 툴바 배열을 그대로 쓰되 그 항목만 찾아 아이콘·툴팁을 명확하게
        // 바꾼다 — merge/removeMerge 로직 자체는 라이브러리 것을 그대로 재사용(재구현 없음).
        toolbar: readonly
          ? false
          : (defaultToolbar) => {
              // ⚠️ 2026-08-16 실사용 중 발견: jspreadsheet-ce의 .d.ts 타입 선언(WorksheetOptions/
              // SpreadsheetOptions 양쪽)은 이 콜백 인자를 `ToolbarItem[]`(배열)로 명시하지만,
              // 실제 컴파일된 런타임 구현(node_modules/jspreadsheet-ce/dist/index.js)은
              // `{items: ToolbarItem[]}`(items 프로퍼티를 가진 객체)를 전달한다 — 타입선언과
              // 런타임 동작이 어긋나는 라이브러리 자체의 결함. 배열로 가정하고
              // `for...of defaultToolbar`를 실행하면 "defaultToolbar is not iterable"로
              // 초기화 자체가 크래시한다(Stephen "화면이 아예 안 열림" 제보 원인). 두 형태
              // 모두 방어적으로 처리 — items 프로퍼티가 배열이면 그것을, 아니면 인자 자체가
              // 배열인 경우를 폴백으로 사용.
              const rec = defaultToolbar as unknown as { items?: unknown[] }
              const items: unknown[] = Array.isArray(rec.items)
                ? rec.items
                : Array.isArray(defaultToolbar)
                  ? (defaultToolbar as unknown[])
                  : []
              for (const item of items) {
                const itemRec = item as unknown as Record<string, unknown>
                if (itemRec['content'] === 'web') {
                  itemRec['content'] = 'merge_type'
                  itemRec['tooltip'] = '선택한 셀 병합 / 병합 해제'
                }
              }
              return defaultToolbar
            },
        worksheets: worksheetConfigs,
        // ─────────────────────────────────────────────────────────────────────
        // "수정 저장" 버튼 isDirty 판정용 변경 감지 (2026-08-28, Stephen 요청)
        //
        // jspreadsheet-ce는 "무언가 하나라도 바뀌었다"를 한 번에 알려주는 단일 이벤트가
        // 없다 — 실제로 콘텐츠를 바꾸는 조작(셀 값·서식·컬럼너비·병합·행/열 추가삭제·
        // 붙여넣기·정렬·되돌리기/다시하기)마다 서로 다른 이벤트가 개별적으로 발생한다.
        // onselection과 동일하게 이 이벤트들도 WorksheetOptions가 아니라 최상위
        // SpreadsheetOptions 소속이라 여기(jspreadsheet() 최상위 호출 인자)에 등록해야
        // 실제로 호출된다. 전부 동일하게 notifyChange()만 호출(위 skipChangeTracking
        // 가드 경유) — "무엇이 바뀌었는지"는 구분할 필요 없이 "바뀌었다"는 사실만
        // 부모에 전달하면 충분하다.
        // ─────────────────────────────────────────────────────────────────────
        onafterchanges: () => notifyChange(),
        onchangestyle: () => notifyChange(),
        onresizecolumn: () => notifyChange(),
        onresizerow: () => notifyChange(),
        onmerge: () => notifyChange(),
        oninsertrow: () => { notifyChange(); reapplyRepeatRegionAllSheets() },
        ondeleterow: () => { notifyChange(); reapplyRepeatRegionAllSheets() },
        oninsertcolumn: () => notifyChange(),
        ondeletecolumn: () => notifyChange(),
        onmoverow: () => notifyChange(),
        onmovecolumn: () => notifyChange(),
        onpaste: () => notifyChange(),
        onundo: () => notifyChange(),
        onredo: () => notifyChange(),
        onsort: () => notifyChange(),
        // ⚠️ y2는 jspreadsheet-ce가 실제로 전달하는 4번째 인자 — .d.ts 타입선언에는 없지만
        // 런타임에서 항상 제공된다(드래그 선택의 끝 행). 반복 영역 행 범위 캡처에 필요.
        onselection: (instance: unknown, x1: number, y1: number, _x2: number, y2: number) => {
          if (isWorksheetLike(instance)) {
            lastSelectedWs = instance
            lastSelectedCoords = [x1, y1]
            // 반복 영역 지정을 위해 마지막 선택 행 범위를 캐시 (Stage 3, 2026-08-28)
            lastSelectedRowRange = { y1, y2: y2 ?? y1 }
            // 활성 시트 인덱스 갱신 (탭 전환 시에도 onselection이 호출됨)
            if (spreadsheetParent) {
              activeSheetIndexState = spreadsheetParent.getWorksheetActive()
            }
            // 이미지 레이어 클릭은 pointerdown에서 preventDefault+stopPropagation으로
            // 이 onselection 자체가 발생하지 않도록 막아뒀다 — 따라서 여기 도달했다는 건
            // 보통 "이미지가 아닌 다른 곳(다른 셀 등)을 선택했다"는 뜻이므로 이전에 선택돼
            // 있던 이미지 레이어의 플로팅 툴바를 닫는다(2026-08-16 이미지 선택/이동/삭제
            // 신규개발). ⚠️ 2026-08-19 긴급수정 — 크기 프리셋 버튼으로 너비를 바꾸면
            // ws.setValueFromCoords()가 셀 값을 갱신하면서 jspreadsheet-ce가 내부적으로
            // "같은 셀"에 대해 이 onselection을 한 번 더 스스로 재발화한다(사용자가 실제로
            // 다른 셀을 클릭한 게 아님). 이때 무조건 deselectOverlayImage()를 호출하면
            // renderCellValue()가 재렌더링 직후 `activeOverlayCellKey === cellKey` 조건으로
            // 다시 열어둔 툴바를 바로 뒤이어 닫아버려 "크기 조절 버튼을 누르면 즉시
            // 사라진다"로 보였다(Stephen 실사용 재현). 새로 선택된 셀 좌표가 현재 오버레이
            // 선택 중인 셀과 동일하면(자기 자신의 값 변경으로 인한 재발화) 닫지 않는다.
            const key = `${x1},${y1}`
            if (key !== activeOverlayCellKey) deselectOverlayImage()
          }
        },
      })

      // SpreadsheetInstance 참조 확보 (첫 번째 워크시트의 .parent 속성)
      if (wsInstances.length > 0) {
        // WorksheetInstance.parent는 SpreadsheetInstance이나 정적 타입 연결이 없어
        // unknown을 거쳐 Record<string, unknown>으로 접근 후 타입 가드로 좁힌다
        const firstWs = wsInstances[0] as unknown as Record<string, unknown>
        const parent = firstWs['parent']
        if (isSpreadsheetParent(parent)) {
          spreadsheetParent = parent

          // jspreadsheet.destroy()는 JspreadsheetInstanceElement(HTMLDivElement + .spreadsheet)를
          // 기대하지만, 초기화 후 parent.el이 실제로 그 요소다.
          // 런타임 확인('spreadsheet' in el)으로 안전을 보장한 뒤 한 번만 narrowing.
          const capturedEl = parent.el
          destroyFn = () => {
            try {
              if ('spreadsheet' in capturedEl) {
                // capturedEl은 jspreadsheet 초기화로 JspreadsheetInstanceElement가 됐음
                // 단 한 곳의 라이브러리 경계 타입 cast (런타임 가드 확인 완료)
                jspreadsheet.destroy(
                  capturedEl as unknown as Parameters<typeof jspreadsheet.destroy>[0],
                  true,
                )
              }
            } catch {
              // 정리 실패 무시 (컴포넌트 이미 소멸 중)
            }
          }
        }
      }

      initialized = true
      // 생성자 호출 도중(및 그 직후 마이크로태스크에서) 발생하는 초기 렌더링용
      // 이벤트를 모두 흘려보낸 뒤에야 실제 사용자 편집 감지를 시작한다.
      // 동시에 반복 영역 DOM 밴드도 그리드 완전 렌더링 후에 적용한다(Stage 3, 2026-08-28).
      setTimeout(() => {
        skipChangeTracking = false
        // jspreadsheet-ce 런타임 worksheet 인스턴스의 .table 프로퍼티로 <table> 요소 확보
        wsTableElements = wsInstances.map((ws) => {
          const t = (ws as unknown as Record<string, unknown>)['table']
          return t instanceof HTMLTableElement ? t : null
        })
        // initialDoc에서 복원한 반복 영역을 DOM에 반영
        sheetRepeatRegions.forEach((region, i) => {
          if (region) applyRepeatRegionDOM(i, region)
        })
      }, 0)
    } catch (err) {
      initError = err instanceof Error ? err.message : '스프레드시트 에디터 로딩 실패'
    }
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 정리
  // ─────────────────────────────────────────────────────────────────────────────

  onDestroy(() => {
    destroyFn?.()
    spreadsheetParent = null
  })
</script>

<div class="cse-wrap">
  {#if !readonly}
    <!-- 서명/직인 이미지 삽입 (기존 GET /api/cms/signature-assets 재사용, 2026-08-16) -->
    <div class="cse-toolbar">
      <div class="cse-sig-group">
        <button
          type="button"
          class="cse-sig-btn"
          class:active={showSigPicker}
          onclick={openSigPicker}
          title="서명/직인 이미지 삽입"
          aria-label="서명/직인 이미지 삽입"
          aria-expanded={showSigPicker}
          aria-haspopup="listbox"
        >서명/직인 삽입</button>

        {#if showSigPicker}
          <div class="cse-sig-popover" role="listbox" aria-label="서명/직인 자산 목록">
            {#if sigLoading}
              <div class="cse-sig-info">불러오는 중...</div>
            {:else if sigAssets.length === 0}
              <div class="cse-sig-info cse-sig-empty">
                등록된 서명·직인이 없습니다.<br />'서명 &amp; 직인 이미지 등록' 버튼으로 먼저 등록하세요.
              </div>
            {:else}
              <div class="cse-sig-list">
                {#each sigAssets as asset (asset.id)}
                  <button
                    type="button"
                    class="cse-sig-item"
                    role="option"
                    aria-selected={false}
                    onclick={() => insertSigAsset(asset)}
                    aria-label="{asset.asset_type === 'signature' ? '서명' : '직인'} 삽입{asset.label ? ': ' + asset.label : ''}"
                  >
                    <img
                      src={asset.image_url}
                      alt="{asset.asset_type === 'signature' ? '서명' : '직인'} 미리보기"
                      class="cse-sig-thumb"
                    />
                    <div class="cse-sig-meta">
                      <span class="cse-sig-label">{asset.label ?? (asset.asset_type === 'signature' ? '서명' : '직인')}</span>
                      <span class="cse-sig-badge cse-sig-badge--{asset.asset_type}">{asset.asset_type === 'signature' ? '서명' : '직인'}</span>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <span class="cse-sep"></span>

      <!-- A4 용지 맞춤 · A4 출력 (2026-08-16) -->
      <div class="cse-tool-group" role="group" aria-label="A4 용지 도구">
        <button
          type="button"
          class="cse-tool-btn"
          onclick={fitColumnsToA4}
          title="현재 컬럼 너비를 A4 용지 폭에 맞춥니다"
        >A4 폭 맞춤</button>
        <button
          type="button"
          class="cse-tool-btn"
          onclick={printAsA4}
          title="A4 용지 기준으로 인쇄합니다"
        >A4 출력</button>
      </div>

      <!-- 반복 영역 지정 (Stage 3, 2026-08-28) — 드래그로 행 범위 선택 후 클릭으로 지정/해제 -->
      <span class="cse-sep"></span>
      <div class="cse-tool-group cse-repeat-group" role="group" aria-label="반복 영역 도구">
        {#if sheetRepeatRegions[activeSheetIndexState]}
          <span class="cse-repeat-badge" title="현재 반복 영역 행 범위">
            {sheetRepeatRegions[activeSheetIndexState]!.startRow + 1}~{sheetRepeatRegions[activeSheetIndexState]!.endRow + 1}행
          </span>
        {/if}
        <button
          type="button"
          class="cse-tool-btn"
          class:cse-repeat-active={!!sheetRepeatRegions[activeSheetIndexState]}
          onclick={toggleRepeatRegion}
          title={sheetRepeatRegions[activeSheetIndexState]
            ? '현재 반복 영역 지정을 해제합니다'
            : '드래그로 행 범위를 선택한 뒤 클릭하면 반복 영역으로 지정됩니다'}
        >{sheetRepeatRegions[activeSheetIndexState] ? '반복 해제' : '반복 영역 지정'}</button>
      </div>

      <!-- 2026-08-19: 크기조절 UI 중복 제거(Stephen 요청) — 이전에는 이 상단 툴바에도
           "선택한 셀" 기준 크기설정 바(소/중/대+너비입력+삭제)가 있어 이미지를 직접 클릭했을
           때 뜨는 플로팅 툴바(renderCellValue()의 bar)와 완전히 같은 기능이 두 군데 중복
           존재했다. 이제 크기 조절·삭제는 이미지를 클릭해 뜨는 플로팅 툴바 하나로 통일 —
           updateOverlayWidthAtSelection/removeOverlayAtSelection/selectedHasOverlay 등
           이 상단 툴바 전용이던 상태·함수는 전부 제거. -->
      <p class="cse-sig-hint">
        {'셀을 먼저 선택한 뒤 눌러주세요. 삽입된 이미지를 클릭하면 크기 조절·삭제 도구가 나타납니다.'}
      </p>
    </div>
  {/if}

  {#if initError}
    <div class="spreadsheet-error" role="alert">
      스프레드시트 로딩 오류: {initError}
    </div>
  {:else if !initialized}
    <div class="spreadsheet-loading" aria-label="스프레드시트 로딩 중...">
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
    </div>
  {/if}
  <!--
    컨테이너는 항상 DOM에 존재해야 onMount의 bind:this가 설정된다.
    초기화 완료 전까지 visually-hidden 처리.
  -->
  <div
    bind:this={containerEl}
    class="spreadsheet-container"
    class:is-ready={initialized}
  ></div>
</div>

<style>
  /*
   * ⛔ 2026-08-16 스크롤 회귀 수정 — 이 루트 div는 원래 `.cse-wrap`이었어야 했다(파일 전체가
   * cse- 접두사 규약을 따름). 실수로 `.spreadsheet-editor-wrap`(패널 레벨 래퍼와 동일한
   * 이름)으로 작성돼 있었는데, ContractTemplatePanel.svelte의
   * `.spreadsheet-editor-wrap :global(.cse-wrap) { flex:1; min-height:0 }` 규칙(문서형
   * `.editor-col :global(.cde-wrap)`과 동일한, 내부 스크롤이 정상 작동하려면 반드시 필요한
   * 높이 경계 지정)이 이 셀렉터 불일치 때문에 단 한 번도 매칭되지 않았다 — 즉 이 컴포넌트는
   * 높이 제약을 전혀 받지 못한 채 내용만큼 계속 늘어났고, 결과적으로 `.spreadsheet-container`
   * 내부(overflow:auto)가 아니라 페이지 전체가 스크롤되며 위쪽 툴바(.cse-toolbar +
   * jspreadsheet 자체 네이티브 툴바)까지 함께 밀려 올라가 사라지는 증상으로 나타났다
   * (Stephen "편집 메뉴 UI가 문서 스크롤 시 함께 묶여 올라가 사라짐" 제보, 문서형은
   * `.cde-wrap`이 정확히 이 패턴이라 정상 동작했음). 클래스명만 맞춰도 별도 CSS 추가 없이
   * 해결된다 — ContractTemplatePanel.svelte는 수정하지 않음(그 파일의 셀렉터가 원래 옳았음).
   */
  .cse-wrap {
    width: 100%;
    height: 100%;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  /* 로딩 스켈레톤 */
  .spreadsheet-loading {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .skeleton-line {
    height: 14px;
    background: #e8e8e8;
    border-radius: 4px;
    animation: sk-pulse 1.4s ease-in-out infinite;
  }

  .skeleton-line.short {
    width: 60%;
  }

  @keyframes sk-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  /* 오류 메시지 */
  .spreadsheet-error {
    margin: 16px;
    padding: 14px 16px;
    background: #fff5f5;
    border: 1px solid #ffc5c5;
    border-radius: var(--radius-sm, 8px);
    color: #cc2200;
    font-size: 13px;
    line-height: 1.5;
  }

  /* 스프레드시트 컨테이너 — 초기화 완료 전 숨김 */
  .spreadsheet-container {
    flex: 1;
    width: 100%;
    min-height: 300px;
    overflow: auto;
    /* 초기화 전: 크기 없이 숨김 (jspreadsheet가 DOM에 접근할 수 있도록 display:none 금지) */
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }

  /* 초기화 완료 후 표시 */
  .spreadsheet-container.is-ready {
    opacity: 1;
    pointer-events: auto;
  }

  /* ⛔ 2026-08-16 확대/축소 기능 제거(긴급) — CSS zoom을 이 컨테이너(jspreadsheet-ce가 직접
     마운트·관리하는 바로 그 엘리먼트)에 적용했더니 Stephen 실사용 중 "셀 너비 조절이
     갑자기 안 됨" 회귀가 발생했다. 원인 확정: jspreadsheet-ce의 컬럼 리사이즈 히트테스트는
     `헤더셀.getBoundingClientRect().width - mousedownEvent.offsetX < 6`px로 "테두리 6px
     이내를 눌렀는가"를 판정하는데(node_modules/jspreadsheet-ce/dist/index.js 소스 직접
     확인), CSS zoom이 적용된 조상 아래에서는 각 브라우저 엔진마다 offsetX와
     getBoundingClientRect()의 줌 반영 방식이 미묘하게 달라 이 두 값이 어긋나는 사례가
     실사용 중 확인됐다(jQuery UI가 같은 이유로 .offset() 기반 위젯 전체에 zoom 지원을
     별도로 패치해야 했던 것과 동일 부류의 문제 — jquery/jquery#5561). zoom:100%(항등값)
     에서도 재현됐다 — zoom 속성 자체가 존재하는 것만으로 일부 엔진이 다른 레이아웃 경로를
     타는 것으로 추정. transform:scale()도 동일한 offsetX/getBoundingClientRect 불일치
     위험군이라 대체 수단으로 쓸 수 없다. → 편집 정확성이 확대/축소 편의 기능보다 우선이라
     즉시 제거. 이 컨테이너에는 향후에도 zoom/transform 계열 CSS를 절대 적용하지 말 것
     (재도입 시 반드시 실사용 리사이즈 테스트로 회귀 여부 확인 후 적용). */

  /* 서명/직인 삽입 서브 툴바 (ContractDocumentEditor.svelte .cde-sig-* 와 동일 패턴) */
  /* ContractDocumentEditor.svelte .cde-toolbar와 동일한 배경 톤으로 통일(2026-08-16) —
     이전엔 배경이 투명해 바로 아래 jspreadsheet 네이티브 툴바(회색 배경)와 이질감이 있었다. */
  .cse-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: var(--cs-surface-gray, #f6f6f6);
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }

  .cse-sig-group {
    position: relative;
  }

  .cse-sig-btn {
    min-height: 28px;
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-sm, 8px);
    font-size: 12px;
    font-weight: 600;
    color: var(--cs-text, #100B32);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
    white-space: nowrap;
  }
  .cse-sig-btn:hover { background: var(--cs-lilac, #ECEBF4); }
  .cse-sig-btn.active {
    background: var(--cs-purple-op10, rgba(59,47,138,0.1));
    border-color: var(--cs-purple, #3B2F8A);
    color: var(--cs-purple, #3B2F8A);
  }

  /* 이미지 크기설정 바(소/중/대+너비입력+삭제)는 2026-08-19부터 renderCellValue()가 이미지
     클릭 시 띄우는 플로팅 툴바 하나로 통일됐다 — 이 상단 툴바 전용이던 .cse-size-group/
     .cse-size-btn/.cse-size-input/.cse-remove-btn CSS는 중복이라 제거(마크업도 함께 제거). */
  .cse-sep {
    width: 1px;
    height: 18px;
    background: var(--cs-lilac, #ECEBF4);
  }

  .cse-sig-hint {
    margin: 0;
    font-size: 11px;
    color: var(--cs-text-mid, #666);
  }

  /* A4 용지 도구 (2026-08-16) — .cse-size-btn과 동일 톤. 확대/축소는 2026-08-16 셀 리사이즈
     회귀(위 .spreadsheet-container 주석 참고)로 제거됨 — 관련 CSS도 함께 제거. */
  .cse-tool-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .cse-tool-btn {
    min-height: 24px;
    min-width: 24px;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--cs-text, #100B32);
    cursor: pointer;
    line-height: 1.4;
    white-space: nowrap;
    transition: background 0.1s, border-color 0.1s;
  }
  .cse-tool-btn:hover:not(:disabled) {
    background: var(--cs-lilac, #ECEBF4);
  }
  .cse-tool-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* 반복 영역 지정 버튼 — 활성(지정된) 상태 (Stage 3, 2026-08-28) */
  .cse-tool-btn.cse-repeat-active {
    background: var(--cs-purple-op10, rgba(59, 47, 138, 0.10));
    border-color: var(--cs-purple, #3B2F8A);
    color: var(--cs-purple, #3B2F8A);
  }
  .cse-tool-btn.cse-repeat-active:hover {
    background: rgba(59, 47, 138, 0.16);
  }

  /* 현재 반복 영역 행 범위 표시 배지 */
  .cse-repeat-badge {
    font-size: 10px;
    font-weight: 700;
    color: var(--cs-purple, #3B2F8A);
    background: var(--cs-purple-op10, rgba(59, 47, 138, 0.10));
    border-radius: var(--radius-full, 99px);
    padding: 1px 7px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cse-repeat-group {
    flex-shrink: 0;
  }

  /* ─────────────────────────────────────────────────────────────────────────────
   * 반복 영역 행 시각적 밴드 (Stage 3, 2026-08-28)
   * data-cse-repeat 속성은 applyRepeatRegionDOM()이 <tr>에 직접 설정한다.
   * <tr>에 background-color를 적용하면 jspreadsheet의 셀 선택 강조(<td>에 직접 적용)가
   * 자연스럽게 우선됨 — !important 충돌 없이 선택 하이라이트와 공존 가능.
   * ───────────────────────────────────────────────────────────────────────────── */

  /* 반복 영역 전체 행 — 연한 보라 배경 */
  .spreadsheet-container :global(tr[data-cse-repeat]) {
    background-color: rgba(59, 47, 138, 0.06);
  }

  /* 반복 영역 첫 행(또는 단독 행) — 약간 더 진한 배경 + 상단 경계선 */
  .spreadsheet-container :global(tr[data-cse-repeat="first"] > td),
  .spreadsheet-container :global(tr[data-cse-repeat="only"] > td) {
    border-top: 2px solid rgba(59, 47, 138, 0.45) !important;
  }
  .spreadsheet-container :global(tr[data-cse-repeat="first"]),
  .spreadsheet-container :global(tr[data-cse-repeat="only"]) {
    background-color: rgba(59, 47, 138, 0.10);
  }

  /* 반복 영역 끝 행(또는 단독 행) — 하단 경계선 */
  .spreadsheet-container :global(tr[data-cse-repeat="last"] > td),
  .spreadsheet-container :global(tr[data-cse-repeat="only"] > td) {
    border-bottom: 2px solid rgba(59, 47, 138, 0.45) !important;
  }

  /* 반복 영역 첫 번째 열 — 왼쪽 강조 인디케이터 */
  .spreadsheet-container :global(tr[data-cse-repeat] > td:first-child) {
    box-shadow: inset 3px 0 0 rgba(59, 47, 138, 0.5) !important;
  }

  .cse-sig-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 200;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--cms-radius-sm, 8px);
    box-shadow: 0 4px 16px rgba(16, 11, 50, 0.12);
    min-width: 220px;
    max-width: 320px;
    overflow: hidden;
  }

  .cse-sig-info {
    padding: 14px 16px;
    font-size: 12px;
    color: var(--cs-text-mid, #666);
    line-height: 1.6;
    text-align: center;
  }

  .cse-sig-empty {
    color: var(--cs-text-mid, #666);
  }

  .cse-sig-list {
    display: flex;
    flex-direction: column;
    max-height: 280px;
    overflow-y: auto;
    padding: 4px;
  }

  .cse-sig-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--cms-radius-sm, 8px);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, border-color 0.1s;
    width: 100%;
  }
  .cse-sig-item:hover {
    background: var(--cs-lilac, #ECEBF4);
    border-color: var(--cs-lilac, #ECEBF4);
  }

  .cse-sig-thumb {
    width: 48px;
    height: 32px;
    object-fit: contain;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: 4px;
    background: #fafafa;
    flex-shrink: 0;
  }

  .cse-sig-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .cse-sig-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--cs-text, #100B32);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cse-sig-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 99px;
    line-height: 1.4;
  }
  .cse-sig-badge--signature {
    background: rgba(59, 47, 138, 0.08);
    color: var(--cs-purple, #3B2F8A);
  }
  .cse-sig-badge--seal {
    background: rgba(16, 11, 50, 0.07);
    color: var(--cs-text, #100B32);
  }

  /* 이미지 레이어 래퍼(renderCellValue()가 생성하는 <div class="cse-cell-image-wrap">) —
     셀 텍스트 위에 겹치는 선택·드래그 가능한 레이어(도장 개념). 위치(top/left/transform)는
     드래그 오프셋을 반영해 JS가 인라인으로 매번 지정 — 여기서는 상호작용 관련 속성만.
     ⚠️ 이전 버전은 이미지에 pointer-events:none을 줘서 클릭이 셀로 그대로 통과해버려
     "이미지 자체 선택"이 불가능했음(2026-08-16 Stephen 제보) — 이제는 이 래퍼가 직접
     포인터 이벤트를 받아 선택·드래그를 처리한다.
     jspreadsheet-ce 셀 내부에 렌더링되므로 :global() 필요 */
  .spreadsheet-container :global(.cse-cell-image-wrap) {
    cursor: grab;
    /* pointerdown/move/up으로 직접 드래그를 처리하므로 브라우저 기본 터치 스크롤/줌
       제스처가 끼어들지 않도록 비활성화 */
    touch-action: none;
  }
  .spreadsheet-container :global(.cse-cell-image-wrap:active) {
    cursor: grabbing;
  }

  /*
   * ⛔ 2026-08-17 긴급수정 — "크기 설정 창을 조작할 수 없고 클릭하면 사라짐" (Stephen 제보,
   * <launch-selected-element> 실측). renderCellValue()가 `cell.style.overflow = 'visible'`을
   * 인라인으로 지정하지만, jspreadsheet-ce가 셀 선택·재렌더링 시 그 td의 style을 자체적으로
   * 다시 써 이 인라인 오버라이드를 지워버린다(실측: 선택된 이미지 셀의 computedOverflow가
   * "hidden"으로 되돌아가 있고 inline style에 overflow 자체가 아예 없었음 — jspreadsheet.css
   * 179행 `.jss_overflow > tbody > tr > td { overflow: hidden }` 규칙이 다시 이김). 크기설정
   * 플로팅 툴바는 셀 위쪽으로 튀어나오게 배치되는데(bottom: calc(100% + 4px)), 이 td
   * overflow:hidden 때문에 툴바가 시각적으로도 클리핑되고 클릭도 통과하지 못해 그 자리의
   * td가 대신 클릭을 받는다 — 그 클릭이 그리드 셀 재선택으로 처리되며 onselection이
   * deselectOverlayImage()를 호출해 "클릭하면 사라짐"으로 보인다. JS 인라인 스타일은
   * jspreadsheet가 계속 되돌리므로 신뢰할 수 없다 — 대신 CSS 규칙으로 우리 이미지 레이어를
   * 가진 셀만 특정해 overflow:visible을 강제한다(다른 일반 텍스트 셀의 overflow:hidden은
   * 그대로 유지 — 긴 텍스트가 옆 셀로 넘치는 것을 막는 jspreadsheet 자체 의도이므로 전역
   * 해제하지 않음).
   */
  .spreadsheet-container :global(.jss_overflow > tbody > tr > td:has(.cse-cell-image-wrap)) {
    overflow: visible !important;
  }

  /* 이미지 자체 — 위치는 부모 wrap이 담당, 여기서는 크기만.
     ⚠️ max-width:80%/max-height:70%(셀 크기 기준 %)였던 기존 값은 폐기 — 실제 도장이
     인장란보다 큰 것처럼 셀보다 커도 되는데, 셀 크기에 강제로 눌려 100/200/400 프리셋을
     눌러도 시각적으로 거의 차이가 안 나던 "크기 조절이 안 된다" 제보의 실제 원인이었음
     (2026-08-16). width는 renderCellValue()가 인라인 style로 직접 지정하므로 여기서는
     극단값 방지용 안전 상한만 둔다. */
  .spreadsheet-container :global(.cse-cell-image) {
    display: block;
    height: auto;
    max-width: 600px;
  }

  /* 이미지 레이어 플로팅 툴바(크기 프리셋+너비입력+삭제)는 renderCellValue()가 전부
     인라인 style로 직접 구성한다(ContractDocumentEditor.svelte ImageWithNodeView와 동일
     원칙) — 별도 CSS 클래스 불필요. */

  /*
   * ⛔ 2026-08-16 편집 메뉴 UI 통일(Stephen 요청) — jspreadsheet-ce가 자체적으로 그리는
   * 네이티브 툴바(undo/redo/save/폰트/정렬/색상/병합/테두리/전체화면, `.jss_toolbar`)는
   * 우리가 만든 DOM이 아니라 라이브러리가 마운트 시점에 통째로 생성하는 서드파티 위젯이라
   * .svelte 마크업으로 직접 재구현할 수 없다 — 위 `.cse-toolbar`(서명/직인 삽입·A4 도구,
   * 우리가 완전히 커스텀으로 만든 부분)와 이 네이티브 툴바가 "완전히 다르게 디자인된"
   * 근본 이유가 이것이다(문서형 ContractDocumentEditor.svelte의 .cde-toolbar는 반대로
   * 100% 우리 마크업이라 처음부터 자유롭게 디자인 가능했음). 다만 완전한 재구현 없이도
   * CSS로 우리 CMS 디자인 토큰(--cs-surface-gray/--cs-lilac/--cs-purple)에 맞춰 덧씌우는
   * 것은 가능해, 문서형 .cde-toolbar/.cde-btn과 동일한 배경·호버·활성 톤으로 통일한다
   * (jspreadsheet.css 기본값은 #f3f3f3 배경 + #ccc 테두리로 우리 토큰과 완전히 무관했음).
   */
  /*
   * ⛔ 2026-08-16 잔여 스크롤 문제 — 위 .cse-wrap 클래스명 수정으로 "페이지 전체가
   * 스크롤되며 툴바가 사라지는" 증상은 해소됐지만, 이 네이티브 툴바 자체는 여전히
   * .spreadsheet-container(유일한 overflow:auto 스크롤 박스) 안쪽에 위치한다 — 시트
   * 내용이 길어 내부 스크롤이 발생하면 이 툴바만 스크롤에 딸려 사라진다. .cse-toolbar
   * (우리 커스텀 툴바)는 이미 스크롤 박스 바깥이라 영향 없음. position:sticky로
   * .spreadsheet-container 상단에 고정해 동일한 "스크롤해도 편집메뉴 유지" 동작을
   * 맞춘다 — 중간 조상(.jss_container 등)에 overflow 제약이 없어(기본값 visible)
   * sticky 동작을 막지 않는다(jspreadsheet.css 확인 완료).
   *
   * ⛔ 2026-08-28 추가 — 아래 "기준자 바 고정" 절에서 tableOverflow를 꺼서 가로 스크롤을
   * `.jss_content` 대신 이 `.spreadsheet-container`가 전담하게 되면서, 이 툴바도 함께
   * 좌우로 흘러가버리는 회귀가 생겼다(실측: scrollLeft=100 적용 시 툴바 x좌표가 그만큼
   * 그대로 왼쪽으로 이동 — sticky가 top만 걸려있고 left는 없었기 때문). left:0을 추가해
   * 가로 스크롤에도 화면 왼쪽에 고정되도록 보정. z-index도 기준자 바(thead 3 · 코너 4)
   * 보다 위(5)로 올려 항상 최상단에 보이게 한다.
   */
  .spreadsheet-container :global(.jss_toolbar) {
    background: var(--cs-surface-gray, #f6f6f6);
    border: none;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: 0;
    margin: 0;
    padding: 6px 10px;
    position: sticky;
    top: 0;
    left: 0;
    z-index: 5;
  }
  .spreadsheet-container :global(.jtoolbar-item) {
    border-radius: var(--radius-sm, 8px);
    transition: background 0.1s;
  }
  .spreadsheet-container :global(.jtoolbar-item:hover) {
    background-color: var(--cs-lilac, #ECEBF4);
  }
  .spreadsheet-container :global(.jtoolbar-item i) {
    color: var(--cs-text, #100B32);
  }
  .spreadsheet-container :global(.jtoolbar-active),
  .spreadsheet-container :global(.jtoolbar-arrow-selected .jtoolbar-item) {
    background-color: var(--cs-purple-op10, rgba(59, 47, 138, 0.1));
  }
  .spreadsheet-container :global(.jtoolbar-active i) {
    color: var(--cs-purple, #3B2F8A);
  }
  .spreadsheet-container :global(.jtoolbar .jtoolbar-divisor) {
    background-color: var(--cs-lilac, #ECEBF4);
  }
  .spreadsheet-container :global(.jtoolbar .jpicker-header) {
    font-size: 12px;
    color: var(--cs-text, #100B32);
  }

  /*
   * 열(A,B,C…)·행(1,2,3…) 기준자 바 캔버스 스크롤 고정 (2026-08-28, Stephen UX 요청)
   *
   * ⛔ 최초 구현(2026-08-28 초판)은 이 두 규칙만으로는 세로 스크롤 고정이 안 돼(아래
   * 참고) JS scroll 리스너 + transform:translateY 보정을 덧붙였으나, 그 결과 thead가
   * 실제 레이아웃 위치는 그대로 둔 채 "그림만" 이동해 스크롤된 실제 콘텐츠 위에
   * 겹쳐 그려지는 부작용(열 문자 바가 문서 중간에 떠 있는 것처럼 보임 — Stephen 실사용
   * 중 재현)이 있었다. 근본 원인은 jspreadsheet-ce의 tableOverflow:true 옵션이
   * `.jss_content`에 자체 overflow-x:auto를 걸어 별도의 가로 스크롤 래퍼를 만드는
   * 것이었다 — CSS 스펙상 overflow-x가 'visible'이 아니면 overflow-y도 자동으로
   * 'auto'가 되어(브라우저 강제 계산값) `.jss_content`가 세로축에서도 "스크롤
   * 컨테이너"로 취급되지만, 정작 세로 스크롤은 그 바깥 `.spreadsheet-container`가
   * 담당해 `.jss_content` 자신은 실제로 스크롤되는 일이 없다 — position:sticky의
   * "가장 가까운 스크롤 조상"이 엉뚱한 `.jss_content`로 잡혀 top이 고정되지 않았다.
   *
   * ✅ 최종 해결: spreadsheetWidgetAdapter.ts sheetToWorksheetConfig()에서
   * tableOverflow를 false로 꺼서 이 내부 래퍼 자체를 생성하지 않는다 — 가로 스크롤도
   * 세로 스크롤과 동일하게 바깥 `.spreadsheet-container`(CSS overflow:auto, 원래도
   * 양축 모두 처리 가능) 하나가 전담하게 되어, thead·행 번호 열 모두 position:sticky의
   * "가장 가까운 스크롤 조상"이 항상 이 컨테이너와 일치한다 — JS 보정 없이 아래
   * 순수 CSS만으로 두 축 모두 정상 고정된다(실측 확인).
   *
   * top: 41px는 .jss_toolbar의 실측 높이(padding 6px*2 + 버튼 높이) — 툴바도 sticky
   * top:0이므로 그 바로 아래에 이어 붙어야 겹치지 않는다.
   * 코너 셀(.jss_selectall)은 가로·세로 두 축 모두 고정돼야 하므로 두 규칙이 함께
   * 적용되고, 다른 sticky 요소보다 z-index를 더 높여 항상 최상단에 보이게 한다.
   */
  .spreadsheet-container :global(.jss_worksheet thead td) {
    position: sticky;
    top: 41px;
    z-index: 3;
    background: var(--cs-surface-gray, #f6f6f6);
  }
  .spreadsheet-container :global(.jss_worksheet tbody td.jss_row) {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--cs-surface-gray, #f6f6f6);
  }
  .spreadsheet-container :global(.jss_worksheet thead td.jss_selectall) {
    left: 0;
    z-index: 4;
  }

  /*
   * 드래그 선택 영역 시각적 표시 강화 (2026-08-28, Stephen 요청)
   *
   * jspreadsheet-ce는 다중 셀 드래그선택 자체는 정상 동작하지만(내부적으로
   * .highlight/.highlight-selected/.highlight-top·left·right·bottom 클래스를 정확히
   * 붙임 — 실측 확인), 기본 CSS(jspreadsheet.css)가 이 클래스들에 주는 효과가
   * `background-color:rgba(0,0,0,0.05)`(5% 검정)와 `border-*:1px solid #000` 정도로
   * 매우 옅다. 계약서 셀 대부분이 이미 자체 서식(배경색·테두리를 인라인 style로 직접
   * 지정 — spreadsheetWidgetAdapter.ts formattingToCss)을 갖고 있는데, 인라인 style은
   * 항상 외부 stylesheet 클래스 규칙보다 우선하므로 그 기본 highlight 효과가 완전히
   * 가려져 "드래그해도 선택된 게 안 보인다"로 이어졌다(2026-08-28 Stephen 재현).
   *
   * 해결: 인라인 style이 절대 건드리지 않는 속성만 사용한다.
   *   - 채움: background-color 대신 background-image(단색 linear-gradient)를 얹는다.
   *     background-image는 background-color와 별개 레이어라 인라인 background-color
   *     위에도 그대로 겹쳐 그려진다(같은 background 축약형이 아닌 한 서로 안 가림).
   *   - 테두리: border 대신 box-shadow(inset)를 쓴다. box-shadow는 셀 서식 데이터
   *     (XlsxCellFormatting)에 아예 없는 속성이라 어떤 셀에도 인라인으로 지정될 일이
   *     없음 — 항상 위에 그려짐이 보장된다.
   */
  .spreadsheet-container :global(.jss_worksheet .highlight) {
    background-image: linear-gradient(rgba(59, 47, 138, 0.22), rgba(59, 47, 138, 0.22));
  }
  .spreadsheet-container :global(.jss_worksheet .highlight-selected) {
    background-image: linear-gradient(rgba(59, 47, 138, 0.36), rgba(59, 47, 138, 0.36));
  }
  .spreadsheet-container :global(.jss_worksheet .highlight-top) {
    box-shadow: inset 0 2px 0 0 var(--cs-purple, #3B2F8A);
  }
  .spreadsheet-container :global(.jss_worksheet .highlight-left) {
    box-shadow: inset 2px 0 0 0 var(--cs-purple, #3B2F8A);
  }
  .spreadsheet-container :global(.jss_worksheet .highlight-right) {
    box-shadow: inset -2px 0 0 0 var(--cs-purple, #3B2F8A);
  }
  .spreadsheet-container :global(.jss_worksheet .highlight-bottom) {
    box-shadow: inset 0 -2px 0 0 var(--cs-purple, #3B2F8A);
  }
  /* box-shadow는 셀당 하나만 그려지므로, 모서리 셀(두 변이 동시에 선택 경계)은
     두 방향을 합성한 값을 직접 지정 — jspreadsheet.css가 highlight-top.highlight-left
     조합에만 자체 대응하던 것과 동일한 원칙을 4방향 전부로 확장. */
  .spreadsheet-container :global(.jss_worksheet .highlight-top.highlight-left) {
    box-shadow: inset 2px 2px 0 0 var(--cs-purple, #3B2F8A);
  }
  .spreadsheet-container :global(.jss_worksheet .highlight-top.highlight-right) {
    box-shadow: inset -2px 2px 0 0 var(--cs-purple, #3B2F8A);
  }
  .spreadsheet-container :global(.jss_worksheet .highlight-bottom.highlight-left) {
    box-shadow: inset 2px -2px 0 0 var(--cs-purple, #3B2F8A);
  }
  .spreadsheet-container :global(.jss_worksheet .highlight-bottom.highlight-right) {
    box-shadow: inset -2px -2px 0 0 var(--cs-purple, #3B2F8A);
  }
  /* 단일 활성 셀(앵커) 테두리 — 4방향 selection-* 클래스가 항상 함께 붙는 경우
     (jspreadsheet.css 기본 동작)를 하나의 링으로 합성. */
  .spreadsheet-container :global(.jss_worksheet .selection-top.selection-left.selection-right.selection-bottom) {
    box-shadow: inset 0 0 0 2px var(--cs-purple, #3B2F8A);
  }
</style>
