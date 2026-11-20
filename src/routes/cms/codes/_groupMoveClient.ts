// 코드조합 이동 창이 /cms/codes 의 폼 액션(?/previewGroupComboMove 등)을 fetch 로 호출하는 작은 헬퍼 (2026-11-19)
import { deserialize } from '$app/forms'

export type ActionCallResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

export async function callCodesAction(action: string, fields: Record<string, string>): Promise<ActionCallResult> {
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.set(k, v)
  try {
    const res = await fetch(`?/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } })
    const result = deserialize(await res.text())
    if (result.type === 'success') return { ok: true, data: (result.data ?? {}) as Record<string, unknown> }
    if (result.type === 'failure') {
      const err = (result.data as { error?: unknown } | undefined)?.error
      return { ok: false, error: typeof err === 'string' ? err : '요청에 실패했습니다.' }
    }
    return { ok: false, error: '요청 처리 중 오류가 발생했습니다.' }
  } catch {
    return { ok: false, error: '네트워크 오류가 발생했습니다.' }
  }
}
