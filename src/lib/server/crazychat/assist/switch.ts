// switch.ts — AI 조력 생성기(API 호출형) 비활성 스위치 (서버 전용)
// 결정(Stephen, 2026-10-08): Anthropic API는 당분간 쓰지 않는다. 삭제하지 않고 "비활성"으로 보존한다.
// 켜는 방법은 이 폴더의 README.md 참고. ANTHROPIC_ENABLED(기존 AI 의도분류)와 같은 "상수 한 곳" 패턴이다.
export const ASSIST_ENABLED = false

export function assistDisabledResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'AI 조력 생성기는 현재 비활성 상태입니다.', disabled: true }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  )
}
