<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'

  interface Props {
    action: string
    id: string
    /** 1차 클릭 경고 토스트 문구 */
    warnMessage?: string
    /** 삭제 성공 토스트 문구 */
    successMessage?: string
    /** 삭제 성공 후 콜백 */
    onsuccess?: () => void
    /** 삭제 실패 후 콜백 */
    onfail?: (error: string) => void
    /** 'lg' = cms-uiux.md §0-10-G DetailPanel 전용 대형 삭제·거부 버튼(44px·레드 채움). 기본값은 기존 아이콘형 */
    size?: 'default' | 'lg'
  }

  let {
    action,
    id,
    warnMessage = '한번 더 선택 시 삭제됩니다.',
    successMessage = '삭제되었습니다.',
    onsuccess,
    onfail,
    size = 'default',
  }: Props = $props()

  let pending = $state(false)
</script>

<form
  method="POST"
  {action}
  use:enhance={({ cancel }) => {
    if (!pending) {
      pending = true
      csToast.warning(warnMessage)
      cancel()
      return
    }
    pending = false
    return async ({ result, update }) => {
      if (result.type === 'success') {
        csToast.success(successMessage)
        onsuccess?.()
        await update()
      } else if (result.type === 'failure') {
        const msg = (result.data as { error?: string })?.error ?? '삭제에 실패했습니다.'
        csToast.error(msg)
        onfail?.(msg)
      }
    }
  }}
>
  <input type="hidden" name="id" value={id} />
  <button
    type="submit"
    class="act-del"
    class:act-del--pending={pending}
    class:act-del--lg={size === 'lg'}
    aria-label={pending ? '삭제 확인' : '삭제'}
    title={pending ? '삭제 확인' : '삭제'}
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3,6 5,6 21,6"/>
      <path d="M19,6l-1,14H6L5,6"/>
      <path d="M10,11v6M14,11v6"/>
      <path d="M9,6V4h6v2"/>
    </svg>
  </button>
</form>

<style>
  .act-del {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    color: var(--cs-text-light);
    transition: background 0.1s, color 0.1s;
    flex-shrink: 0;
  }
  .act-del:hover {
    background: rgba(255, 53, 53, 0.08);
    color: var(--cs-red-badge);
  }
  .act-del--pending {
    color: var(--cs-red-badge);
    background: rgba(255, 53, 53, 0.08);
  }
  /* §0-10-G 대형 — 삭제·거부 버튼(.btn-danger-sm)과 동일 규격. 1차 클릭(pending)은 더 진한 레드로 구분 */
  .act-del--lg {
    height: 44px;
    padding: 0 20px;
    background: var(--cs-error);
    color: var(--cs-white);
    border-radius: var(--cms-radius-md);
    transition: opacity 0.12s, background 0.12s;
  }
  .act-del--lg:hover {
    background: var(--cs-error);
    color: var(--cs-white);
    opacity: 0.85;
  }
  .act-del--lg.act-del--pending {
    background: var(--cs-red);
    color: var(--cs-white);
  }
</style>
