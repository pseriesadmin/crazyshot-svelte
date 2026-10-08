// model.ts — AI 조력 생성기 전용 모델 호출(서버 전용). 분석 1회에 큰 JSON을 받으므로 답변 폴백(400토큰·8초)과 한도를 분리한다.
import type { AssistModelCaller } from './pipeline'

export const ASSIST_MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 3000
const TIMEOUT_MS = 60_000

export const assistModelCaller: AssistModelCaller = async ({ system, userTurn }) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const { ANTHROPIC_API_KEY } = await import('$env/static/private')
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 없음')
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const res = await client.messages.create(
    { model: ASSIST_MODEL, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content: userTurn }] },
    { timeout: TIMEOUT_MS, maxRetries: 0 },
  )
  const block = res.content[0]
  return {
    text: block && block.type === 'text' ? block.text : '',
    inputTokens: res.usage?.input_tokens ?? null,
    outputTokens: res.usage?.output_tokens ?? null,
  }
}
