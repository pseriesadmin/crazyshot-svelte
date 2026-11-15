import { deserialize } from '$app/forms'

export interface BadgeActionResult {
  ok: boolean
  error?: string
  id?: string
}

/** /cms/promotion/ad 폼 액션을 fetch 로 호출한다(드래그 정렬·패널 저장용). */
export async function postBadgeAction(
  action: string,
  fields: Record<string, string | string[]>
): Promise<BadgeActionResult> {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item)
    else fd.append(k, v)
  }
  try {
    const res = await fetch(`/cms/promotion/ad?/${action}`, {
      method: 'POST',
      body: fd,
      headers: { 'x-sveltekit-action': 'true' },
    })
    const result = deserialize(await res.text())
    if (result.type === 'success' || result.type === 'failure') {
      const data = (result.data ?? {}) as Partial<BadgeActionResult>
      return { ok: data.ok === true, error: data.error, id: data.id }
    }
    return { ok: false, error: '처리에 실패했어요' }
  } catch {
    return { ok: false, error: '네트워크 오류가 발생했어요' }
  }
}
