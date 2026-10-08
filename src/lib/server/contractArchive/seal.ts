/**
 * seal.ts — 최종본 PDF "서명 봉인"(Ed25519)
 *
 * 보관 시점에 서버 비밀키로 [계약·증적·서명·최종본 id, 서명 일시, PDF 지문, 쪽별 지문 지도 지문]에 전자서명을 만든다.
 * 비밀키는 Vercel 환경변수(ARCHIVE_SEAL_KEY)에만 있고 DB·저장소에는 없다 → DB와 저장소를 함께 바꿔도 새 서명을 만들 수 없다.
 * 공개키는 공개 엔드포인트로 제공되어 누구나(서버 DB 없이도) 서명을 검증할 수 있다.
 *
 * 키 형식: PKCS#8 PEM("-----BEGIN PRIVATE KEY-----", 줄바꿈이 \n 글자로 들어와도 됨) 또는 PKCS#8 DER의 base64.
 * 키 교체: 새 키로 바꾸면 이후 봉인은 새 키로 만들어지고, 이전 봉인은 key_id로 구분된다 — 이전 공개키는
 *   ARCHIVE_SEAL_PUBLIC_KEYS(PEM 배열의 JSON)에 남겨 두어야 계속 검증된다.
 */
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'node:crypto'

export const SEAL_ALGORITHM = 'ed25519'
export const SEAL_VERSION = 1

export interface SealKey {
  privateKey: KeyObject
  publicKey: KeyObject
  keyId: string
  publicKeyPem: string
}

export interface SealPublicKey {
  publicKey: KeyObject
  keyId: string
  publicKeyPem: string
}

function keyIdOf(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

function toPublicKey(publicKey: KeyObject): SealPublicKey {
  return { publicKey, keyId: keyIdOf(publicKey), publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }
}

/** 환경변수 값에서 봉인 키를 읽는다. 없거나 형식이 잘못되면 null(봉인 기능 꺼짐 — 보관 자체는 계속된다). */
export function loadSealKey(raw: string | undefined | null): SealKey | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  try {
    const normalized = text.replace(/\\n/g, '\n')
    const privateKey = normalized.includes('BEGIN')
      ? createPrivateKey(normalized)
      : createPrivateKey({ key: Buffer.from(normalized, 'base64'), format: 'der', type: 'pkcs8' })
    if (privateKey.asymmetricKeyType !== 'ed25519') return null
    const pub = toPublicKey(createPublicKey(privateKey))
    return { privateKey, ...pub }
  } catch {
    return null
  }
}

/** 검증에 쓸 공개키 목록: 현재 키의 공개키 + ARCHIVE_SEAL_PUBLIC_KEYS(JSON 배열)의 이전 키들 */
export function loadSealPublicKeys(currentKey: SealKey | null, extraJson: string | undefined | null): SealPublicKey[] {
  const out = new Map<string, SealPublicKey>()
  if (currentKey) out.set(currentKey.keyId, { publicKey: currentKey.publicKey, keyId: currentKey.keyId, publicKeyPem: currentKey.publicKeyPem })
  if (extraJson && extraJson.trim()) {
    try {
      const list = JSON.parse(extraJson) as unknown
      if (Array.isArray(list)) {
        for (const pem of list) {
          if (typeof pem !== 'string') continue
          try {
            const pk = toPublicKey(createPublicKey(pem.replace(/\\n/g, '\n')))
            if (pk.publicKey.asymmetricKeyType === 'ed25519') out.set(pk.keyId, pk)
          } catch { /* 형식이 잘못된 항목은 무시 */ }
        }
      }
    } catch { /* JSON이 아니면 무시 */ }
  }
  return [...out.values()]
}

export interface SealMessageInput {
  contractId: string
  evidenceId: string
  signingId: string
  finalDocumentId: string
  signedAt: string // ISO — 호출부가 new Date(...).toISOString()으로 정규화해 넘긴다
  pdfSha256: string
  pageMapSha256: string
  source: 'original' | 'regenerated'
}

/** 서명 대상 원문 — 줄바꿈 구분 고정 형식. 형식을 바꾸면 SEAL_VERSION을 올려야 한다. */
export function buildSealMessage(m: SealMessageInput): string {
  return [
    `CZ-SEAL-v${SEAL_VERSION}`,
    `contract_id=${m.contractId}`,
    `evidence_id=${m.evidenceId}`,
    `signing_id=${m.signingId}`,
    `final_document_id=${m.finalDocumentId}`,
    `signed_at=${m.signedAt}`,
    `pdf_sha256=${m.pdfSha256}`,
    `page_map_sha256=${m.pageMapSha256}`,
    `source=${m.source}`,
  ].join('\n')
}

export function signSeal(key: SealKey, message: string): string {
  return cryptoSign(null, Buffer.from(message, 'utf8'), key.privateKey).toString('base64')
}

export function verifySealSignature(publicKey: KeyObject, message: string, signatureBase64: string): boolean {
  try {
    return cryptoVerify(null, Buffer.from(message, 'utf8'), publicKey, Buffer.from(signatureBase64, 'base64'))
  } catch {
    return false
  }
}
