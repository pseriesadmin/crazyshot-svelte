<script lang="ts">
  /**
   * KeywordTagInput — 키워드 태그 입력(최대 10개). IME-SAFE-INPUT 패턴(core-rules.md):
   * ① Enter는 e.isComposing 체크 ② add()가 빈값·중복·최대치를 내부에서 방어.
   */
  interface Props {
    keywords: string[]
    max?: number
    /** 읽기 전용 — 입력·삭제 불가, 태그만 보여준다 */
    readonly?: boolean
  }

  let { keywords = $bindable([]), max = 10, readonly = false }: Props = $props()
  let kwInput = $state('')

  function add() {
    const kw = kwInput.trim().replace(/^#+/, '')
    kwInput = ''
    if (!kw || keywords.includes(kw) || keywords.length >= max) return
    keywords = [...keywords, kw]
  }

  function remove(kw: string) {
    keywords = keywords.filter((k) => k !== kw)
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && kwInput === '' && keywords.length > 0) {
      keywords = keywords.slice(0, -1)
    }
  }
</script>

<div class="kw-area" role="group" aria-label={`키워드 태그 (최대 ${max}개)`}>
  <div class="kw-list">
    {#each keywords as kw (kw)}
      <span class="kw-tag">
        <span class="kw-hash">#</span>{kw}
        {#if !readonly}<button type="button" class="kw-del" onclick={() => remove(kw)} aria-label={`${kw} 태그 삭제`}>×</button>{/if}
      </span>
    {/each}
    {#if !readonly && keywords.length < max}
      <input
        type="text"
        class="kw-input"
        placeholder={keywords.length === 0 ? `#태그를 입력해주세요 (최대 ${max}개)` : '태그 추가...'}
        bind:value={kwInput}
        {onkeydown}
        onblur={add}
        maxlength="30"
        aria-label="키워드 입력"
      />
    {/if}
  </div>
  <span class="kw-count">{keywords.length}/{max}</span>
</div>

<style>
  .kw-area {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 16px;
    background: var(--cs-surface-gray);
    border-top: 1px solid var(--cs-border);
  }
  .kw-list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .kw-tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px 4px 10px;
    border-radius: var(--radius-full);
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .kw-hash { opacity: 0.6; }
  .kw-del {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--cs-purple);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    opacity: 0.6;
  }
  .kw-del:hover { opacity: 1; }
  .kw-input {
    flex: 1;
    min-width: 120px;
    min-height: 32px;
    border: none;
    background: transparent;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    outline: none;
  }
  .kw-input::placeholder { color: var(--cs-text-placeholder); }
  .kw-count {
    flex-shrink: 0;
    padding-top: 8px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  @media (max-width: 767px) {
    .kw-input { font-size: 16px; }
  }
</style>
