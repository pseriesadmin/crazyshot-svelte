/**
 * contractUnsavedGuard.ts — 계약서 양식 편집 화면 이탈 경고 (2026-10-29, 스프레드시트·문서형·HTML형 공용)
 *
 * 편집 패널(ContractTemplatePanel)이 "저장하지 않은 내용이 있는지"를 등록하면, 같은 화면의 다른 코드(목록에서 다른 양식 선택·
 * 새 양식 작성·패널 닫기)가 상태를 바꾸기 전에 confirmDiscardUnsaved() 로 확인할 수 있다. 주소 이동(goto)만 가로채는
 * beforeNavigate 로는 이런 "같은 페이지 안의 패널 교체"를 막지 못해서 필요하다.
 */
import { csToast } from '$lib/utils/toast'

export interface UnsavedProbe {
  /** 저장하지 않은 내용이 있는가 */
  isDirty: () => boolean
  /** 사용자가 "나가기"를 확정했을 때 — 임시저장을 지우고 이중 경고를 막는다 */
  discard: () => void
}

export const UNSAVED_SHEET_MESSAGE = '저장하지 않은 내용이 있어요. 나가면 작성 중인 내용이 사라집니다. 나갈까요?'

let probe: UnsavedProbe | null = null

/** 이 시간(ms)보다 빨리 "취소"가 돌아오면 사람이 누른 게 아니라 확인창이 표시되지 않은 것으로 본다 */
const AUTO_DISMISS_MS = 60

/**
 * window.confirm 래퍼 — 내장 브라우저 등 확인창을 띄우지 못하는 환경에서는 호출 즉시 "취소"가 돌아와
 * 화면이 아무 반응 없이 멈춘 것처럼 보이므로, 그 경우 토스트로 이유를 알린다(결과는 그대로 false).
 */
export function askConfirm(message: string): boolean {
  const started = performance.now()
  const ok = confirm(message)
  if (!ok && performance.now() - started < AUTO_DISMISS_MS) {
    csToast.warning('확인창이 표시되지 않아 작업이 취소됐어요. 일반 브라우저(Chrome·Safari)에서 다시 시도해 주세요.')
  }
  return ok
}

/** 등록하고, 해제 함수를 돌려준다(컴포넌트 정리 시 호출) */
export function registerUnsavedProbe(next: UnsavedProbe): () => void {
  probe = next
  return () => {
    if (probe === next) probe = null
  }
}

/** 저장하지 않은 내용이 없거나 사용자가 나가기를 확정하면 true. 취소하면 false(호출부는 동작을 중단) */
export function confirmDiscardUnsaved(): boolean {
  if (!probe || !probe.isDirty()) return true
  if (!askConfirm(UNSAVED_SHEET_MESSAGE)) return false
  probe.discard()
  return true
}
