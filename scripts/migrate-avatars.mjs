#!/usr/bin/env node
/**
 * 기존 프로필 아바타 이전 — user-documents(전환 이전 공개 URL) → user-avatars (2026-10-03, 서류 비공개 전환 B2/B3 ③단계)
 *
 * 왜: 서류(user-documents)를 비공개로 전환(#638)하면 그 버킷에 있는 아바타 공개 URL이 모두 깨진다. 아바타는 <img src>로 직접 노출되는
 *     공개 이미지라 전용 공개 버킷 user-avatars(#637로 생성)로 옮겨야 한다. 이전하면서 256×256 WebP로 줄여 원본(수 MB)을 매 페이지
 *     서빙하던 트래픽도 함께 제거한다.
 *
 * 동작(사용자별): avatar_url이 user-documents 공개 URL인 프로필 → 원본 다운로드 → 256px 정사각 WebP 변환 → user-avatars 업로드 →
 *     avatar_url 갱신(compare-and-set: 이전 URL이 그대로일 때만 — 그 사이 사용자가 새 아바타를 올렸다면 덮어쓰지 않고 새 파일을 지운다)
 *     → (--delete-old) 이전 파일 삭제. 이미 user-avatars를 가리키는 행·아바타가 아닌 URL은 건너뛴다(멱등, 여러 번 실행 가능).
 *
 * 기본은 읽기 전용 점검(--dry-run)이다. 실제 이전은 --apply, 이전 원본 삭제는 --apply --delete-old 를 줘야 한다.
 *   --purge-leftover : 이미 user-avatars로 이전된 사용자의 user-documents 폴더에 남은 옛 아바타 파일(`avatar_*`)을 찾아 보고하고,
 *                      --apply --delete-old 와 함께면 삭제한다(과거 이전 때 원본을 남겼거나 구코드가 마지막으로 올린 파일 정리용). 서류 파일은 건드리지 않는다.
 *
 * 실행 예 (Production 키는 파일에 저장하지 않고 실행 시점에만 주입):
 *   Stage 점검    : node --env-file=.env.local scripts/migrate-avatars.mjs --target stage
 *   Stage 이전    : node --env-file=.env.local scripts/migrate-avatars.mjs --target stage --apply
 *   Production    : PROD_SERVICE_ROLE_KEY=... node scripts/migrate-avatars.mjs --target production --apply
 *   원본까지 삭제 : (위 명령) --apply --delete-old   ← #638 직전 마지막 실행에서
 *
 * 이미지 변환에는 sharp가 필요하다(package.json에는 넣지 않는다 — 일회성 도구):  npm i --no-save sharp
 * Stage 접속 정보는 .env.local(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — 현재 Stage 연결)을 쓴다.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const PROD_REF = 'vnbpmvxruyciuuaermyh'
const STAGE_REF = 'ezyvffjvuwmtuhpxdjrw'
const SRC_BUCKET = 'user-documents'
const DST_BUCKET = 'user-avatars'
const SRC_MARKER = `/storage/v1/object/public/${SRC_BUCKET}/`
const DST_MARKER = `/storage/v1/object/public/${DST_BUCKET}/`
const AVATAR_SIZE = 256

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const target = opt('--target')
const apply = flag('--apply')
const deleteOld = flag('--delete-old')
const purgeLeftover = flag('--purge-leftover')

function fail(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

if (target !== 'stage' && target !== 'production') fail('--target stage|production 을 지정하세요.')
if (deleteOld && !apply) fail('--delete-old 는 --apply 와 함께만 사용할 수 있습니다.')

let url
let key
if (target === 'stage') {
  url = process.env.PUBLIC_SUPABASE_URL
  key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) fail('Stage 접속 정보가 없습니다 (node --env-file=.env.local ... 로 실행).')
  if (!url.includes(STAGE_REF)) fail(`.env.local이 Stage(${STAGE_REF})를 가리키지 않습니다: ${url}`)
} else {
  url = `https://${PROD_REF}.supabase.co`
  key = process.env.PROD_SERVICE_ROLE_KEY
  if (!key) fail('PROD_SERVICE_ROLE_KEY 가 없습니다 (실행 시점에만 주입하세요).')
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

/** 이 사용자의 아바타 파일 경로(`{uid}/avatar_…`)만 인정 — 서류 파일 등은 절대 건드리지 않는다 */
function sourcePath(avatarUrl, userId) {
  const idx = avatarUrl.indexOf(SRC_MARKER)
  if (idx < 0) return null
  let path = avatarUrl.slice(idx + SRC_MARKER.length).split('#')[0].split('?')[0]
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (!path.startsWith(`${userId}/avatar_`)) return null
  if (path.split('/').some((s) => s === '..' || s === '.' || s === '')) return null
  return path
}

let sharp = null
if (apply) {
  try {
    sharp = (await import('sharp')).default
  } catch {
    fail('sharp 가 필요합니다. 먼저 실행하세요:  npm i --no-save sharp')
  }
}

console.log(`대상: ${target} (${url})  모드: ${apply ? (deleteOld ? 'APPLY + 이전 원본 삭제' : 'APPLY') : 'DRY-RUN(읽기 전용)'}`)

// 이전 대상 조회 — 전환 이전 공개 URL을 가진 프로필
const { data: rows, error: selErr } = await admin
  .from('user_profiles')
  .select('user_id, avatar_url')
  .like('avatar_url', `%${SRC_MARKER}%`)
if (selErr) fail(`프로필 조회 실패: ${selErr.message}`)

const { count: alreadyMigrated } = await admin
  .from('user_profiles')
  .select('user_id', { count: 'exact', head: true })
  .like('avatar_url', `%${DST_MARKER}%`)

console.log(`user-documents 아바타 ${rows.length}건 / 이미 user-avatars ${alreadyMigrated ?? 0}건`)

const summary = { migrated: 0, skipped: 0, failed: 0, deletedOld: 0, deleteFailed: 0 }

for (const row of rows) {
  const { user_id: userId, avatar_url: oldUrl } = row
  const label = `${userId.slice(0, 8)}…`
  const srcPath = sourcePath(oldUrl, userId)
  if (!srcPath) {
    console.log(`  - ${label} 건너뜀: 아바타 파일 경로가 아님(${oldUrl.split('/').slice(-2).join('/')})`)
    summary.skipped++
    continue
  }

  if (!apply) {
    console.log(`  · ${label} 이전 대상: ${SRC_BUCKET}/${srcPath}`)
    continue
  }

  // 1) 원본 다운로드
  const { data: blob, error: dlErr } = await admin.storage.from(SRC_BUCKET).download(srcPath)
  if (dlErr || !blob) {
    console.error(`  ✖ ${label} 다운로드 실패(원본 유지): ${dlErr?.message ?? 'no data'}`)
    summary.failed++
    continue
  }

  // 2) 256px 정사각 WebP 변환 (EXIF 회전 반영, 중앙 크롭)
  let webp
  try {
    webp = await sharp(Buffer.from(await blob.arrayBuffer()))
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toBuffer()
  } catch (e) {
    console.error(`  ✖ ${label} 이미지 변환 실패(원본 유지): ${e instanceof Error ? e.message : e}`)
    summary.failed++
    continue
  }

  // 3) 새 버킷 업로드
  const newPath = `${userId}/avatar_${randomUUID()}.webp`
  const { error: upErr } = await admin.storage.from(DST_BUCKET).upload(newPath, webp, { contentType: 'image/webp', upsert: false })
  if (upErr) {
    console.error(`  ✖ ${label} 업로드 실패(원본 유지): ${upErr.message}`)
    summary.failed++
    continue
  }
  const newUrl = admin.storage.from(DST_BUCKET).getPublicUrl(newPath).data.publicUrl

  // 4) avatar_url 갱신 — 이전 URL이 그대로일 때만(compare-and-set)
  const { data: updated, error: updErr } = await admin
    .from('user_profiles')
    .update({ avatar_url: newUrl })
    .eq('user_id', userId)
    .eq('avatar_url', oldUrl)
    .select('user_id')
  let applied = !updErr && !!updated && updated.length > 0
  if (updErr) {
    // 오류 응답이어도 실제로는 DB에 반영됐을 수 있다(네트워크 끊김 등) — 롤백 전에 현재 값을 다시 읽어 확인한다.
    // 반영된 상태에서 새 파일을 지우면 avatar_url이 삭제된 파일을 가리키게 된다.
    const { data: recheck, error: recheckErr } = await admin.from('user_profiles').select('avatar_url').eq('user_id', userId).maybeSingle()
    if (recheckErr) {
      console.error(`  ⚠ ${label} 갱신 오류 후 재확인도 실패(${updErr.message} / ${recheckErr.message}) — 새 파일을 지우지 않고 중단합니다. 수동 확인 필요: ${DST_BUCKET}/${newPath}`)
      summary.failed++
      continue
    }
    applied = recheck?.avatar_url === newUrl
  }
  if (!applied) {
    // 사용자가 그 사이 새 아바타를 올렸거나 값이 바뀜 — 방금 올린 파일을 되돌린다
    await admin.storage.from(DST_BUCKET).remove([newPath])
    console.error(`  ✖ ${label} avatar_url 갱신 안 됨(${updErr?.message ?? '값이 그 사이 바뀜'}) — 새 파일 롤백, 원본 유지`)
    summary.failed++
    continue
  }

  console.log(`  ✔ ${label} 이전: ${(blob.size / 1024).toFixed(0)}KB → ${(webp.length / 1024).toFixed(0)}KB (${DST_BUCKET}/${newPath})`)
  summary.migrated++

  // 5) 이전 원본 삭제(--delete-old) — 갱신이 확인된 뒤에만
  if (deleteOld) {
    const { error: rmErr } = await admin.storage.from(SRC_BUCKET).remove([srcPath])
    if (rmErr) { console.error(`    ⚠ ${label} 이전 원본 삭제 실패(수동 정리 필요): ${rmErr.message}`); summary.deleteFailed++ }
    else summary.deletedOld++
  }
}

console.log(`\n요약: 이전 ${summary.migrated} · 건너뜀 ${summary.skipped} · 실패 ${summary.failed}${deleteOld ? ` · 원본 삭제 ${summary.deletedOld}${summary.deleteFailed ? ` (삭제 실패 ${summary.deleteFailed})` : ''}` : ''}`)
if (!apply) console.log('※ 읽기 전용 점검입니다. 실제 이전은 --apply 를 붙여 실행하세요.')

// 이미 이전된 사용자의 user-documents 폴더에 남은 옛 아바타 파일 정리(--purge-leftover)
if (purgeLeftover) {
  const { data: migratedRows, error: mErr } = await admin
    .from('user_profiles')
    .select('user_id')
    .like('avatar_url', `%${DST_MARKER}%`)
  if (mErr) fail(`이전 완료 프로필 조회 실패: ${mErr.message}`)
  let found = 0
  let purged = 0
  for (const { user_id: userId } of migratedRows ?? []) {
    const { data: files, error: lsErr } = await admin.storage.from(SRC_BUCKET).list(userId, { limit: 100 })
    if (lsErr) { console.error(`  ✖ ${userId.slice(0, 8)}… 폴더 조회 실패: ${lsErr.message}`); continue }
    const leftovers = (files ?? []).filter((f) => f.name.startsWith('avatar_')).map((f) => `${userId}/${f.name}`)
    found += leftovers.length
    for (const path of leftovers) {
      if (apply && deleteOld) {
        const { error: rmErr } = await admin.storage.from(SRC_BUCKET).remove([path])
        if (rmErr) console.error(`  ✖ 삭제 실패 ${path}: ${rmErr.message}`)
        else { purged++; console.log(`  ✔ 옛 아바타 삭제: ${SRC_BUCKET}/${path}`) }
      } else {
        console.log(`  · 옛 아바타 잔존: ${SRC_BUCKET}/${path}`)
      }
    }
  }
  console.log(`옛 아바타 잔존 ${found}건${apply && deleteOld ? ` · 삭제 ${purged}건` : ' (삭제하려면 --apply --delete-old 를 함께 지정)'}`)
}

// #638(비공개 전환) 직전 검증용 — 아직 user-documents를 가리키는 아바타가 남았는지
const { count: remaining } = await admin
  .from('user_profiles')
  .select('user_id', { count: 'exact', head: true })
  .like('avatar_url', `%${SRC_MARKER}%`)
console.log(`남은 user-documents 아바타 URL: ${remaining ?? '?'}건${apply && (remaining ?? 0) === 0 ? ' ✔ (#638 진행 가능 조건 충족)' : ''}`)
process.exit(summary.failed > 0 || summary.deleteFailed > 0 ? 2 : 0)
