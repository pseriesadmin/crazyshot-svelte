// 삭제 안전장치 토스트 ("삭제 안전 토스트") — 공식 등록 모듈
// cms-uiux.md §0-10-B 정본. 1차 클릭: 토스트 경고 후 제출 취소(무장) / 2차 클릭: 실제 삭제 제출.
// Svelte 5 rune을 쓰는 재사용 상태 팩토리라 .svelte.ts 확장자 필수(일반 .ts는 $state 사용 불가).
import { csToast } from '$lib/utils/toast'
import type { ActionResult } from '@sveltejs/kit'

export interface DeleteSafetyToastOptions {
  /** 1차 클릭 시 뜨는 경고 문구 (기본: '한번 더 누르면 삭제됩니다.') */
  warningMessage?: string
  /** 2차 클릭 후 서버 액션 성공 시 문구 (기본: '삭제됐습니다.') */
  successMessage?: string
  /** 2차 클릭 후 서버 액션 실패 시 문구 (기본: '삭제에 실패했습니다.') */
  errorMessage?: string
  /** 서버 액션 성공 시 추가 콜백(예: 패널 닫기·목록 갱신) */
  onSuccess?: () => void | Promise<void>
}

/**
 * ProductDetailPanel.svelte의 handleDeleteProduct 패턴을 모듈화한 것.
 * use:enhance에 그대로 연결해서 쓴다:
 *
 *   const del = createDeleteSafetyToast({ onSuccess: onclose })
 *   <form method="POST" action="?/deleteX" use:enhance={del.handleSubmit}>
 *     <button type="submit" class="btn-danger" class:btn-danger--pending={del.pending}
 *       disabled={del.isDeleting}>
 *       {del.isDeleting ? '삭제 중...' : del.pending ? '한번 더 누르면 삭제됩니다' : '삭제'}
 *     </button>
 *   </form>
 */
export function createDeleteSafetyToast(options: DeleteSafetyToastOptions = {}) {
  const {
    warningMessage = '한번 더 누르면 삭제됩니다.',
    successMessage = '삭제됐습니다.',
    errorMessage = '삭제에 실패했습니다.',
    onSuccess,
  } = options

  let pending = $state(false)
  let isDeleting = $state(false)

  function handleSubmit({ cancel }: { cancel: () => void }) {
    if (!pending) {
      pending = true
      csToast.warning(warningMessage)
      cancel()
      return
    }
    isDeleting = true
    return async ({ result }: { result: ActionResult }) => {
      isDeleting = false
      pending = false
      if (result.type === 'success') {
        csToast.success(successMessage)
        onSuccess?.()
      } else {
        csToast.error(errorMessage)
      }
    }
  }

  return {
    get pending() { return pending },
    get isDeleting() { return isDeleting },
    handleSubmit,
  }
}
