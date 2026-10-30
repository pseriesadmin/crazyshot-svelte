<script lang="ts">
  /**
   * ContractFileSaveMenu.svelte — 계약서 양식 패널 헤더 "파일 저장 ▾" (2026-10-29)
   *
   * 편집 중인 문서를 내 컴퓨터에 파일로 내려받는다(문서형·HTML형은 .hwp .hwpx .docx .pdf .html, 스프레드시트형은 .xlsx .ods .pdf .html .csv .tsv). 양식 저장(DB)과는 별개이며
   * 저장하지 않은 편집 내용도 그대로 내려받는다. 실제 변환은 docExport/exportContract.ts 가 맡는다.
   * 버튼 모양: cms-uiux.md §0-10-C "초소형 라운드 버튼형"(테두리 없음·면 중심, 호버는 배경색 반전만) — Stephen 지시(2026-10-29).
   * 이웃 "문서 가져오기"(.btn-import)는 그대로 둔다(수정 금지 지시).
   */
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import CmsHelpBubble from '$lib/components/cms/CmsHelpBubble.svelte'
  import { csToast } from '$lib/utils/toast'
  import { exportContractFile, FORMATS_BY_MODE, type ExportFormat, type ExportInput, type ExportMode } from '$lib/utils/docExport/exportContract'

  interface Props {
    /** 작성 모드 — 모드에 맞는 저장 형식만 보여준다(스프레드시트형은 엑셀만) */
    mode: ExportMode
    /** 지금 편집 중인 내용(없으면 null) — 눌렀을 때 호출부가 현재 상태를 돌려준다 */
    getInput: () => ExportInput | null
  }

  let { mode, getInput }: Props = $props()

  const ITEMS: { format: ExportFormat; label: string; help?: string; beta?: boolean }[] = [
    { format: 'hwp', label: '한글 문서 (.hwp)' },
    { format: 'hwpx', label: '한글 문서 (.hwpx)', beta: true, help: '베타: 한컴 오피스에서 열리지 않으면 .hwp로 저장해 주세요.' },
    { format: 'docx', label: 'Word 문서 (.docx)' },
    { format: 'pdf', label: 'PDF (.pdf)' },
    { format: 'html', label: '웹 문서 (.html)' },
    { format: 'xlsx', label: '엑셀 문서 (.xlsx)' },
    { format: 'ods', label: 'OpenDocument (.ods)' },
    { format: 'csv', label: '쉼표로 구분된 값 (.csv)' },
    { format: 'tsv', label: '탭으로 구분된 값 (.tsv)' },
  ]
  // 모드별 허용 형식의 순서대로 보여 준다
  const visibleItems = $derived(
    FORMATS_BY_MODE[mode].flatMap((f) => ITEMS.filter((i) => i.format === f)),
  )

  let open = $state(false)
  let busy = $state<ExportFormat | null>(null)
  let rootEl: HTMLDivElement | undefined = $state()

  function close(): void { open = false }

  $effect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (rootEl && !rootEl.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('click', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  })

  async function save(format: ExportFormat): Promise<void> {
    if (busy) return
    close()
    const input = getInput()
    if (!input) {
      csToast.warning('저장할 내용이 없습니다. 문서를 먼저 작성해 주세요.')
      return
    }
    busy = format
    try {
      const { warnings } = await exportContractFile(format, input)
      for (const w of warnings) csToast.warning(w)
    } catch (e) {
      csToast.error(e instanceof Error && e.message ? e.message : '파일로 저장하지 못했습니다.')
    } finally {
      busy = null
    }
  }
</script>

<div class="fsm" bind:this={rootEl}>
  <button
    type="button"
    class="fsm-btn"
    aria-haspopup="menu"
    aria-expanded={open}
    disabled={busy !== null}
    onclick={() => { open = !open }}
    title="편집 중인 문서를 내 컴퓨터에 파일로 저장"
  >
    {busy ? '저장 중…' : '파일 저장'}
    <span class="fsm-arrow"><ChevronIcon direction="down" size={4.8} color="currentColor" /></span>
  </button>
  {#if open}
    <div class="fsm-menu" role="menu" aria-label="저장할 파일 형식">
      {#each visibleItems as item (item.format)}
        {#if item.help}
          <CmsHelpBubble text={item.help} placement="bottom">
            <button type="button" class="fsm-item" role="menuitem" onclick={() => save(item.format)}>
              {item.label}<span class="fsm-beta">베타</span>
            </button>
          </CmsHelpBubble>
        {:else}
          <button type="button" class="fsm-item" role="menuitem" onclick={() => save(item.format)}>{item.label}</button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .fsm { position: relative; display: inline-flex; }

  /* §0-10-C 초소형 라운드 버튼형 — 값은 정본 .btn-reassign-small 에서 복사(border 없음, 호버는 배경·글자색 반전만).
     화살표 아이콘(ChevronIcon)과 간격만 이 버튼 문맥에 맞게 inline-flex 로 추가했다. */
  .fsm-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 134px; /* 기존 약 89px의 1.5배 */
    flex-shrink: 0;
    font: var(--text-pc-body-14);
    line-height: 1.2; /* 토큰의 200% 줄높이는 상하 패딩과 겹쳐 버튼이 과하게 커진다 */
    padding: 8px 10px;
    border: none;
    border-radius: var(--cms-radius-sm); /* '문서 가져오기'(.btn-import)와 동일 */
    background: var(--cs-lilac);
    color: var(--cs-purple);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }
  /* 글자는 가운데 그대로, 화살표만 우측 끝 가까이에 둔다 */
  .fsm-arrow {
    position: absolute;
    top: 50%;
    right: 12px;
    transform: translateY(-50%);
    display: flex;
  }
  .fsm-btn:hover:not(:disabled) {
    background: var(--cs-purple-op10);
  }
  .fsm-btn:disabled { opacity: 0.5; cursor: default; }

  .fsm-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    min-width: 168px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
  }
  .fsm-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: transparent;
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.1s;
  }
  .fsm-item:hover { background: var(--cs-lilac); }
  .fsm-beta {
    padding: 1px 6px;
    border-radius: var(--radius-full);
    background: var(--cs-lilac);
    font-size: 10px;
    font-weight: 700;
    color: var(--cs-purple);
  }
</style>
