// dragHandleGate.ts — "손잡이에서 시작한 드래그만 허용" 게이트 (순수 함수)
// dragstart 이벤트의 target은 눌린 자식(손잡이)이 아니라 draggable 항목 자체다. 그래서 드래그 직전의
// pointerdown 대상이 손잡이였는지를 기록해 두고 dragstart에서 확인한다.
export interface HandleGate {
  /** pointerdown/mousedown 대상 기록 */
  press(target: EventTarget | null): void
  /** dragstart를 허용해도 되는가 */
  allowDragStart(): boolean
  /** pointerup/dragend/pointercancel에서 기록을 지운다 */
  release(): void
}

export function createHandleGate(handleSelector = '.drag-handle'): HandleGate {
  let fromHandle = false
  return {
    press(target) {
      const closest = (target as { closest?: (s: string) => unknown } | null)?.closest
      fromHandle = typeof closest === 'function' && !!closest.call(target, handleSelector)
    },
    allowDragStart: () => fromHandle,
    release() { fromHandle = false },
  }
}
