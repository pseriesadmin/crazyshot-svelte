/**
 * signatureEvidence.ts — 전자계약 서명 증적(동의·해시·약관 스냅샷) 순수 함수
 *
 * 서명 API(POST /api/contracts/[token]/sign)가 서명 이벤트 1건당 contract_signature_evidence(추가 전용)에
 * 남길 행을 만든다. 핵심 원칙:
 *   - 동의 여부는 클라이언트가 보낸 값을 "형식 검증"만 하고, 해시 대상 텍스트(약관·계약 문단)는 서버가
 *     DB에서 읽은 값만 쓴다 — 클라이언트가 보낸 텍스트·해시는 절대 신뢰하지 않는다.
 *   - 해시는 SHA-256(Web Crypto, Node 18+·브라우저 공용). 한글은 UTF-8로 인코딩.
 *
 * 법적 의의(과장 금지): 이 기록은 "서명 시점에 어떤 내용·약관을 보여줬고 어떤 동의를 받았는가"를 사후에
 * 입증하기 위한 자료이며, 본인 확인(OTP 등)을 대신하지 않는다.
 */

export const CONSENT_KEYS = ['contract', 'privacy', 'terms_copy'] as const
export type ConsentKey = (typeof CONSENT_KEYS)[number]

export const CONSENT_LABELS: Record<ConsentKey, string> = {
  contract: '계약서 내용 확인 및 전자계약 동의',
  privacy: '개인정보 수집·이용 및 고유식별정보 처리 동의',
  terms_copy: '서비스이용정책·환불규정·개인정보처리방침 사본 수령 및 내용 확인',
}

export interface PolicyTexts {
  terms: string
  refund: string
  privacy: string
}

/**
 * rental_policy_settings 조회 결과를 증적용으로 정리한다.
 *   - 조회 오류·행 없음·세 항목 모두 비어 있음 → null ("서명 당시 교부할 약관이 없었음" — 빈 문자열의 해시로 위장하지 않는다)
 *   - 하나라도 내용이 있으면 그대로 반환하되, 비어 있는 항목은 빈 문자열("그 항목은 미등록"이라는 사실)로 둔다.
 * 증적은 추가 전용이라 한 번 남으면 고칠 수 없으므로, 불확실한 값을 확정 사실처럼 저장하지 않는 것이 목적이다.
 */
export function normalizePolicies(
  row: { terms_text?: string | null; refund_text?: string | null; privacy_text?: string | null } | null,
  readFailed: boolean,
): PolicyTexts | null {
  if (readFailed || !row) return null
  const terms = row.terms_text ?? ''
  const refund = row.refund_text ?? ''
  const privacy = row.privacy_text ?? ''
  if (terms.trim() === '' && refund.trim() === '' && privacy.trim() === '') return null
  return { terms, refund, privacy }
}

export interface ConsentLogEntry {
  key: ConsentKey
  label: string
  checked: true
  text_sha256: string | null
  source: string
}

export type ParseConsentsResult = { ok: true } | { ok: false; error: string }

const CONSENT_ERROR = '필수 동의 항목을 모두 확인해 주세요. 화면이 오래된 경우 새로고침 후 다시 서명해 주세요.'

/** 요청 본문의 consents를 형식 검증한다(필수 3종 모두 checked===true, 중복·미지의 키 거부). */
export function parseConsents(raw: unknown): ParseConsentsResult {
  if (!Array.isArray(raw)) return { ok: false, error: CONSENT_ERROR }
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return { ok: false, error: CONSENT_ERROR }
    const { key, checked } = item as { key?: unknown; checked?: unknown }
    if (typeof key !== 'string' || !(CONSENT_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: CONSENT_ERROR }
    }
    if (checked !== true) return { ok: false, error: CONSENT_ERROR }
    if (seen.has(key)) return { ok: false, error: CONSENT_ERROR }
    seen.add(key)
  }
  if (seen.size !== CONSENT_KEYS.length) return { ok: false, error: CONSENT_ERROR }
  return { ok: true }
}

export async function sha256Hex(text: string): Promise<string> {
  const buffer = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function buildConsentLog(args: {
  contentHash: string | null
  contractPrivacyText: string | null
  /** null = 약관을 읽지 못했거나 전부 비어 있음(normalizePolicies 참고) */
  policies: PolicyTexts | null
}): Promise<ConsentLogEntry[]> {
  const { contentHash, contractPrivacyText, policies } = args
  const policyBundle = policies ? [policies.terms, policies.refund, policies.privacy].join('\n---\n') : null
  return [
    {
      key: 'contract',
      label: CONSENT_LABELS.contract,
      checked: true,
      text_sha256: contentHash,
      source: 'contract_signings.content_hash(서명 직전 스냅샷)',
    },
    {
      key: 'privacy',
      label: CONSENT_LABELS.privacy,
      checked: true,
      text_sha256: await sha256Hex(contractPrivacyText ?? ''),
      source: 'contracts.privacy_terms_text',
    },
    {
      key: 'terms_copy',
      label: CONSENT_LABELS.terms_copy,
      checked: true,
      text_sha256: policyBundle != null ? await sha256Hex(policyBundle) : null,
      source: policyBundle != null
        ? 'rental_policy_settings(terms_text+refund_text+privacy_text)'
        : 'rental_policy_settings:unavailable(조회 실패 또는 등록된 약관 없음)',
    },
  ]
}

const USER_AGENT_MAX = 512

export interface EvidenceRowArgs {
  contractId: string
  signingId: string
  reservationId: number | null
  /** 서명 UPDATE에 쓴 것과 동일한 ISO 시각(서명 이벤트 식별자의 일부) */
  signedAt: string
  ipAddress: string | null
  userAgent: string | null
  contentHash: string | null
  contractPrivacyText: string | null
  policies: PolicyTexts | null
  signatureData: string | null
  /** 서명 이미지가 합성된 최종 HTML(html 모드이고 합성에 성공했을 때만) */
  finalHtml: string | null
}

/** contract_signature_evidence에 INSERT할 행을 만든다. */
export async function buildEvidenceRow(args: EvidenceRowArgs): Promise<Record<string, unknown>> {
  const consentLog = await buildConsentLog({
    contentHash: args.contentHash,
    contractPrivacyText: args.contractPrivacyText,
    policies: args.policies,
  })
  return {
    contract_id: args.contractId,
    signing_id: args.signingId,
    reservation_id: args.reservationId,
    signed_at: args.signedAt,
    ip_address: args.ipAddress,
    user_agent: args.userAgent ? args.userAgent.slice(0, USER_AGENT_MAX) : null,
    consent_log: consentLog,
    content_hash: args.contentHash,
    final_html_sha256: args.finalHtml != null ? await sha256Hex(args.finalHtml) : null,
    signature_image_sha256: args.signatureData != null ? await sha256Hex(args.signatureData) : null,
    terms_text: args.policies ? args.policies.terms : null,
    refund_text: args.policies ? args.policies.refund : null,
    privacy_text: args.policies ? args.policies.privacy : null,
    terms_sha256: args.policies ? await sha256Hex(args.policies.terms) : null,
    refund_sha256: args.policies ? await sha256Hex(args.policies.refund) : null,
    privacy_sha256: args.policies ? await sha256Hex(args.policies.privacy) : null,
  }
}
