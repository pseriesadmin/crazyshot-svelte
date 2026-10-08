/**
 * TDD: 드래그 손잡이 게이트 — CmsDragList가 "손잡이에서 시작한 드래그만" 허용하되 실제로 끌리게 한다 (2026-10-08)
 * 결함: dragstart의 e.target은 "손잡이"가 아니라 draggable 항목 자체라서, target.closest('.drag-handle')가 항상 null →
 *       모든 CmsDragList가 끌리지 않았다(2026-09-30 텍스트 선택 버그 수정이 만든 회귀).
 * 해결: 드래그 직전의 포인터 누름(pointerdown) 대상이 손잡이인지 기록해 두고, dragstart에서 그 기록을 본다.
 */
import { describe, it, expect } from 'vitest'
import { createHandleGate } from '$lib/utils/dragHandleGate'

const el = (isHandle: boolean) => ({ closest: (sel: string) => (sel === '.drag-handle' && isHandle ? {} : null) }) as unknown as EventTarget

describe('createHandleGate', () => {
  it('손잡이를 누른 뒤의 dragstart만 허용한다', () => {
    const g = createHandleGate()
    g.press(el(true))
    expect(g.allowDragStart()).toBe(true)
  })
  it('손잡이가 아닌 곳(입력창 등)을 누른 뒤의 dragstart는 막는다', () => {
    const g = createHandleGate()
    g.press(el(false))
    expect(g.allowDragStart()).toBe(false)
  })
  it('누르기 기록이 없으면 막는다(안전 기본값)', () => {
    expect(createHandleGate().allowDragStart()).toBe(false)
  })
  it('release 후에는 다시 막는다(다음 제스처에 이월되지 않음)', () => {
    const g = createHandleGate()
    g.press(el(true))
    g.release()
    expect(g.allowDragStart()).toBe(false)
  })
  it('target이 null이거나 closest가 없는 노드여도 던지지 않는다', () => {
    const g = createHandleGate()
    expect(() => g.press(null)).not.toThrow()
    expect(() => g.press({} as unknown as EventTarget)).not.toThrow()
    expect(g.allowDragStart()).toBe(false)
  })
})
