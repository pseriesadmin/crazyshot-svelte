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

  // ── 폼 없이 쓰는 방식(2026-09-29 추가) ─────────────────────────────────────────
  // RPC·fetch로 삭제하는 화면(예: 크레이지로그 댓글·상품 후기)용. 폼 액션 방식(handleSubmit)과 동일한
  // 2단계 확인(1차: 경고 토스트 + 무장 / 2차: 실제 삭제 → 성공·실패 토스트)을 그대로 따르되,
  // 목록의 여러 항목 중 "무장한 항목만" 2차 클릭에 삭제되도록 항목 key로 무장 상태를 구분한다.
  let pendingKey = $state<string | null>(null)
  let busyKey = $state<string | null>(null)

  /** perform: 실제 삭제를 수행하고 성공 여부(true/false)를 돌려주는 함수(예외 throw도 실패로 처리 — Error 메시지는 실패 토스트에 사유로 표시) */
  async function handleAction(key: string, perform: () => Promise<boolean>): Promise<void> {
    if (busyKey) return
    if (pendingKey !== key) {
      pendingKey = key
      csToast.warning(warningMessage)
      return
    }
    busyKey = key
    try {
      const ok = await perform()
      if (ok) {
        csToast.success(successMessage)
        await onSuccess?.()
      } else {
        csToast.error(errorMessage)
      }
    } catch (err) {
      // perform이 던진 Error 메시지가 있으면 실패 사유를 함께 표시(원인 파악용) + 콘솔 로그
      console.error('[deleteSafety] 삭제 실패:', err)
      const reason = err instanceof Error && err.message ? err.message : ''
      csToast.error(reason ? `${errorMessage} (${reason})` : errorMessage)
    } finally {
      busyKey = null
      pendingKey = null
    }
  }

  return {
    get pending() { return pending },
    get isDeleting() { return isDeleting },
    handleSubmit,
    get pendingKey() { return pendingKey },
    get busyKey() { return busyKey },
    handleAction,
  }
}
