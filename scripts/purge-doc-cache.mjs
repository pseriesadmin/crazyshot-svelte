#!/usr/bin/env node
/**
 * 서류 CDN 잔존 제거 — 서류 객체를 새 경로로 이동하고 DB 경로를 갱신 (2026-10-04, 서류 비공개 전환 사후 조치)
 *
 * 왜: user-documents를 비공개로 전환(#638)했지만, 전환 전에 CDN 엣지에 캐시된 서류가 예상(1시간)보다 오래 공개 URL로 계속 열렸다.
 *     이전 경로의 객체가 사라지면 해당 URL의 캐시가 무효화 대상이 되고, 설령 캐시가 남아도 "예전 URL"은 더 이상 실제 파일과 연결되지 않는다.
 *     새 경로의 파일은 비공개 버킷 + 서명 URL로만 열린다.
 *
 * 동작(서류 파일 1개 = (사용자, 경로) 단위로 1회): ① (기본) 인증 없이 이전 공개 URL을 요청해 아직 열리는 파일만 대상 선정(--all 이면 전부)
 *   ② storage move(old → `{uid}/{identity|foreign}_{새 uuid}.{ext}`) ③ DB 재조회 후 그 경로를 가진 모든 컬럼·모든 요소를 한 번에 치환
 *   (updated_at이 그대로일 때만 갱신, 실패 시 DB를 다시 확인해 새 경로가 참조 중이면 성공 처리·아니면 이동을 되돌림) ④ 새 경로 서명 URL로 열리는지 확인
 *   ⑤ 이전 URL 재요청으로 차단 여부 보고(캐시 전파를 위해 기본 70초 대기 후, --no-wait 로 생략)
 *   --purge-avatars: user-documents 폴더에 남은 옛 아바타 원본(`avatar_*`)을 삭제한다. 단 DB(user_profiles.avatar_url)가 아직 가리키는 파일은 건너뛴다.
 *
 * 기본은 읽기 전용 점검(DRY-RUN). 실제 변경은 --apply. Production --apply는 --yes-production 도 필요하다. 파일 내용은 바꾸지 않고 이름만 바꾼다.
 * ⚠️ 운영 메모: 서류 등록·삭제가 드문 시간대에 실행한다(DB 재조회~갱신 사이의 짧은 구간은 updated_at 비교로만 보호됨).
 *
 * 종료 코드: 0 정상 / 1 설정 오류 / 2 이동·DB 갱신 실패 있음 / 3 되돌림 실패(수동 복구 필요) / 4 이전 URL 여전히 열림·확인 불가·서명 열람 실패
 *
 * 실행 예 (Production 키는 파일에 저장하지 않고 실행 시점에만 주입):
 *   Production 점검 : PROD_SERVICE_ROLE_KEY=... node scripts/purge-doc-cache.mjs --target production
 *   Production 이동 : PROD_SERVICE_ROLE_KEY=... node scripts/purge-doc-cache.mjs --target production --apply --yes-production [--purge-avatars]
 *   Stage 점검/테스트: node --env-file=.env.local scripts/purge-doc-cache.mjs --target stage [--all --apply]
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const PROD_REF = 'vnbpmvxruyciuuaermyh'
const STAGE_REF = 'ezyvffjvuwmtuhpxdjrw'
const BUCKET = 'user-documents'
const MARKER = `/storage/v1/object/public/${BUCKET}/`
const WAIT_MS = 70_000
const FETCH_TIMEOUT_MS = 15_000

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const target = opt('--target')
const apply = flag('--apply')
const all = flag('--all')
const purgeAvatars = flag('--purge-avatars')
const noWait = flag('--no-wait')

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1) }
if (target !== 'stage' && target !== 'production') fail('--target stage|production 을 지정하세요.')
if (target === 'production' && apply && !flag('--yes-production')) fail('Production 변경은 --yes-production 을 함께 지정해야 합니다.')

let url, key
if (target === 'stage') {
  url = process.env.PUBLIC_SUPABASE_URL
  key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) fail('Stage 접속 정보가 없습니다 (node --env-file=.env.local ... 로 실행).')
  url = url.replace(/\/+$/, '')
  if (!url.includes(STAGE_REF)) fail(`.env.local이 Stage(${STAGE_REF})를 가리키지 않습니다: ${url}`)
} else {
  url = `https://${PROD_REF}.supabase.co`
  key = process.env.PROD_SERVICE_ROLE_KEY
  if (!key) fail('PROD_SERVICE_ROLE_KEY 가 없습니다 (실행 시점에만 주입하세요).')
}
// 키의 JWT ref 클레임이 대상 프로젝트와 일치하는지 로컬에서만 확인(키 자체는 출력하지 않음)
try {
  const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'))
  const expected = target === 'production' ? PROD_REF : STAGE_REF
  if (claims.ref && claims.ref !== expected) fail(`키가 ${target} 프로젝트의 것이 아닙니다 (ref 불일치).`)
  if (claims.role && claims.role !== 'service_role') fail('service_role 키가 아닙니다.')
} catch { /* JWT가 아닌 형식의 키(신형 secret key 등)는 아래 접속 확인으로 검증 */ }

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
{
  const { error } = await admin.storage.from(BUCKET).list('', { limit: 1 })
  if (error) fail(`키 또는 접속 확인 실패: ${error.message}`)
}

/** 저장값(경로 또는 공개 URL) → 이 사용자 폴더의 버킷 내부 경로(정확히 `{uid}/{파일}` 2단계). 해석 불가·타 사용자 폴더면 null */
function toPath(value, uid) {
  if (typeof value !== 'string' || !value) return null
  let p = value
  const i = p.indexOf(MARKER)
  if (i >= 0) {
    if (!value.startsWith(`${url}${MARKER}`) && /^https?:/i.test(value)) return null // 다른 호스트의 URL은 해석하지 않음
    p = p.slice(i + MARKER.length)
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//')) return null
  p = p.split('#')[0].split('?')[0]
  try { p = decodeURIComponent(p) } catch { return null }
  p = p.replace(/^\/+/, '')
  const segs = p.split('/')
  if (segs.length !== 2 || segs[0] !== uid || !segs[1] || segs[1] === '.' || segs[1] === '..') return null
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return null
  return p
}

/** 'open' | 'closed' | 'unknown' — 인증 없이 공개 URL이 열리는지(Range 요청으로 본문 전송 회피) */
async function publicState(path) {
  try {
    const res = await fetch(`${url}${MARKER}${path.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status === 200 || res.status === 206) return 'open'
    if (res.status >= 500 || res.status === 429) return 'unknown'
    return 'closed'
  } catch { return 'unknown' }
}

const asArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [])

console.log(`대상: ${target} (${url})  모드: ${apply ? 'APPLY' : 'DRY-RUN(읽기 전용)'}  선정: ${all ? '전부(--all)' : '아직 공개 URL로 열리는 파일만'}`)

// PostgREST 기본 행 제한(1000)에 잘리지 않도록 페이지 단위로 전부 읽는다
const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error: selErr } = await admin
    .from('user_profiles')
    .select('user_id, identity_doc_url, foreign_doc_url, foreign_doc_urls, avatar_url, updated_at')
    .order('user_id')
    .range(from, from + 999)
  if (selErr) fail(`프로필 조회 실패: ${selErr.message}`)
  rows.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
console.log(`프로필 ${rows.length}건 조회`)

// (사용자, 경로) 단위로 묶어 수집 — 같은 파일이 여러 컬럼·여러 번 나와도 이동은 1회
const files = new Map()
let skippedValues = 0
for (const r of rows ?? []) {
  const uid = r.user_id
  const add = (col, v) => {
    const path = toPath(v, uid)
    if (!path) { skippedValues++; return }
    const k = `${uid}|${path}`
    const f = files.get(k) ?? { uid, path, cols: new Set() }
    f.cols.add(col)
    files.set(k, f)
  }
  for (const v of asArray(r.identity_doc_url)) add('identity_doc_url', v)
  for (const v of asArray(r.foreign_doc_urls)) add('foreign_doc_urls', v)
  for (const v of asArray(r.foreign_doc_url)) add('foreign_doc_url', v)
}
const entries = [...files.values()]
console.log(`서류 파일 ${entries.length}건 확인${skippedValues ? ` (해석 불가·타 폴더 값 ${skippedValues}건은 건너뜀 — 확인 필요)` : ''}`)

const targets = []
for (const e of entries) {
  e.state = await publicState(e.path)
  if (all || e.state !== 'closed') targets.push(e)
}
const openCount = entries.filter((e) => e.state === 'open').length
const unknownCount = entries.filter((e) => e.state === 'unknown').length
console.log(`인증 없이 아직 열리는 파일: ${openCount}건 / 확인 불가: ${unknownCount}건 / 이동 대상: ${targets.length}건`)

const summary = { moved: 0, failed: 0, rollbackFailed: 0, verifyFailed: 0, stillOpen: 0, unknown: 0, avatarFailed: 0 }
const movedOld = []
const rollbackLeft = []

/** 한 프로필에서 oldPath를 가진 모든 컬럼·요소를 newPath로 치환한 patch (바뀐 게 없으면 null) */
function buildPatch(cur, uid, oldPath, newPath) {
  const patch = {}
  const swap = (v) => (toPath(v, uid) === oldPath ? newPath : v)
  for (const col of ['identity_doc_url', 'foreign_doc_urls']) {
    const arr = cur[col]
    if (Array.isArray(arr) && arr.some((v) => toPath(v, uid) === oldPath)) patch[col] = arr.map(swap)
  }
  if (typeof cur.foreign_doc_url === 'string' && toPath(cur.foreign_doc_url, uid) === oldPath) patch.foreign_doc_url = newPath
  return Object.keys(patch).length ? patch : null
}

/** DB가 이미 newPath를 참조하는지 */
async function dbReferences(uid, newPath) {
  const { data, error } = await admin.from('user_profiles')
    .select('identity_doc_url, foreign_doc_url, foreign_doc_urls').eq('user_id', uid).maybeSingle()
  if (error || !data) return 'error'
  return [...asArray(data.identity_doc_url), ...asArray(data.foreign_doc_urls), ...asArray(data.foreign_doc_url)]
    .some((v) => toPath(v, uid) === newPath)
}

for (const e of targets) {
  try {
  const label = `${e.uid.slice(0, 8)}… ${e.path.split('/')[1].split('_')[0]}`
  if (!apply) { console.log(`  · ${label} 이동 대상 (${[...e.cols].join('+')})${e.state === 'open' ? ' · 공개 URL 열림' : e.state === 'unknown' ? ' · 확인 불가' : ''}`); continue }

  const name = e.path.split('/')[1]
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot) : ''
  const prefix = e.cols.has('identity_doc_url') && !e.cols.has('foreign_doc_urls') && !e.cols.has('foreign_doc_url') ? 'identity'
    : e.cols.has('identity_doc_url') ? (name.startsWith('foreign_') ? 'foreign' : 'identity') : 'foreign'
  const newPath = `${e.uid}/${prefix}_${randomUUID()}${ext}`

  const { error: mvErr } = await admin.storage.from(BUCKET).move(e.path, newPath)
  if (mvErr) { console.error(`  ✖ ${label} 이동 실패(원본 유지): ${mvErr.message}`); summary.failed++; continue }

  let committed = false
  let reason = ''
  try {
    const { data: cur, error: curErr } = await admin.from('user_profiles')
      .select('identity_doc_url, foreign_doc_url, foreign_doc_urls, updated_at').eq('user_id', e.uid).maybeSingle()
    if (curErr || !cur) throw new Error(curErr?.message ?? '프로필 행 없음')
    const patch = buildPatch(cur, e.uid, e.path, newPath)
    if (!patch) throw new Error('DB 값이 그 사이 바뀜(이 경로를 더 이상 참조하지 않음)')
    let q = admin.from('user_profiles').update(patch).eq('user_id', e.uid)
    q = cur.updated_at ? q.eq('updated_at', cur.updated_at) : q.is('updated_at', null)
    const { data: upd, error: updErr } = await q.select('user_id')
    if (updErr) throw new Error(updErr.message)
    if (!upd || upd.length === 0) throw new Error('갱신된 행 없음(동시 변경 가능)')
    committed = true
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err)
  }

  if (!committed) {
    // 갱신 결과가 불확실한 경우(예외) — DB가 이미 새 경로를 참조하면 되돌리지 않는다
    const ref = await dbReferences(e.uid, newPath).catch(() => 'error')
    if (ref === true) committed = true
    else if (ref === 'error') {
      // DB 상태를 확인할 수 없으면 파일을 되돌리지 않는다(갱신이 실제로 커밋됐을 수 있음) — 수동 확인 대상
      summary.rollbackFailed++
      rollbackLeft.push(`확인 필요: DB가 ${newPath} 를 참조하는지 점검 (원래 ${e.path})`)
      console.error(`  ✖ ${label} DB 상태 확인 불가 — 되돌리지 않음(수동 확인 필요): ${reason}`)
      continue
    }
  }
  if (!committed) {
    const { error: backErr } = await admin.storage.from(BUCKET).move(newPath, e.path)
    if (backErr) {
      summary.rollbackFailed++
      rollbackLeft.push(`${newPath} → ${e.path}`)
      console.error(`  ✖ ${label} DB 갱신 실패 + 되돌림 실패(수동 복구 필요): ${reason}`)
    } else {
      summary.failed++
      console.error(`  ✖ ${label} DB 갱신 실패 → 이동 되돌림: ${reason}`)
    }
    continue
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(newPath, 30)
  let opens = false
  try {
    const res = signed?.signedUrl ? await fetch(signed.signedUrl, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }) : null
    opens = !!res && (res.status === 200 || res.status === 206)
  } catch { opens = false }
  if (!opens) summary.verifyFailed++
  console.log(`  ${opens ? '✔' : '⚠'} ${label} 이동 완료${opens ? '' : ' (새 경로 서명 열람 확인 실패 — 수동 확인)'}`)
  summary.moved++
  movedOld.push(e.path)
  } catch (err) {
    // 예상 밖 예외 — 이동 후 상태가 불확실할 수 있어 수동 확인 대상으로 분류하고 다음 파일로 진행
    summary.rollbackFailed++
    rollbackLeft.push(`확인 필요: ${e.path} (예외: ${err instanceof Error ? err.message : err})`)
    console.error(`  ✖ ${e.uid.slice(0, 8)}… 예상 밖 예외 — 수동 확인 필요: ${err instanceof Error ? err.message : err}`)
  }
}

if (apply && movedOld.length > 0) {
  if (!noWait) { console.log(`\n캐시 전파 대기 ${WAIT_MS / 1000}초…`); await new Promise((r) => setTimeout(r, WAIT_MS)) }
  for (const old of movedOld) {
    const s = await publicState(old)
    if (s === 'open') summary.stillOpen++
    else if (s === 'unknown') summary.unknown++
  }
  console.log(`이전 공개 URL 재요청: 여전히 열림 ${summary.stillOpen} · 확인 불가 ${summary.unknown} / ${movedOld.length}건${summary.stillOpen > 0 ? ' — 캐시 무효화가 안 됐으면 Supabase 지원에 퍼지 요청 필요' : ''}`)
}

// 옛 아바타 원본 정리(--purge-avatars) — DB가 아직 가리키는 파일은 건너뜀
if (purgeAvatars) {
  let found = 0, purged = 0, kept = 0
  for (const r of rows ?? []) {
    const { data: list, error: lsErr } = await admin.storage.from(BUCKET).list(r.user_id, { limit: 1000 })
    if (lsErr) { console.error(`  ✖ ${r.user_id.slice(0, 8)}… 폴더 조회 실패: ${lsErr.message}`); summary.avatarFailed++; continue }
    const avatarRef = typeof r.avatar_url === 'string' ? r.avatar_url : ''
    for (const f of (list ?? []).filter((x) => x.name.startsWith('avatar_'))) {
      const p = `${r.user_id}/${f.name}`
      found++
      if (avatarRef.includes(f.name)) { kept++; console.log(`  · ${r.user_id.slice(0, 8)}… 현재 아바타로 참조 중 — 건너뜀`); continue }
      if (!apply) { console.log(`  · 옛 아바타 원본: ${r.user_id.slice(0, 8)}…/${f.name.slice(0, 14)}…`); continue }
      const { error: rmErr } = await admin.storage.from(BUCKET).remove([p])
      if (rmErr) { console.error(`  ✖ 아바타 삭제 실패: ${rmErr.message}`); summary.avatarFailed++ } else { purged++ }
    }
  }
  console.log(`옛 아바타 원본 ${found}건 · 참조 중이라 보존 ${kept}건${apply ? ` · 삭제 ${purged}건` : ' (삭제하려면 --apply)'}`)
}

console.log(`\n요약: 이동 ${summary.moved} · 실패 ${summary.failed} · 되돌림 실패 ${summary.rollbackFailed} · 서명 열람 확인 실패 ${summary.verifyFailed} · 이전 URL 열림 ${summary.stillOpen} · 확인 불가 ${summary.unknown} · 아바타 오류 ${summary.avatarFailed}`)
if (rollbackLeft.length) { console.error('수동 복구 대상(새 경로 → 원래 경로):'); for (const l of rollbackLeft) console.error(`  ${l}`) }
if (!apply) console.log('※ 읽기 전용 점검입니다. 실제 이동은 --apply 를 붙여 실행하세요.')
process.exit(summary.rollbackFailed > 0 ? 3 : summary.failed > 0 || summary.avatarFailed > 0 ? 2 : summary.stillOpen + summary.unknown + summary.verifyFailed > 0 ? 4 : 0)
