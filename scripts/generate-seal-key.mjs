// 서명 봉인용 Ed25519 키 생성: node scripts/generate-seal-key.mjs
// 출력된 "ARCHIVE_SEAL_KEY" 값을 Vercel 환경변수(Production/Preview 각각 별도 키 권장)에 직접 등록한다.
// 비밀키는 이 터미널 밖(채팅·git·문서)에 남기지 말 것. 공개키는 /api/contracts/seal-public-key 로 공개된다.
import { generateKeyPairSync, createHash } from 'node:crypto'
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const der = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
const keyId = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16)
console.log(`key_id (공개 식별자): ${keyId}`)
console.log(`ARCHIVE_SEAL_KEY=${der}`)
