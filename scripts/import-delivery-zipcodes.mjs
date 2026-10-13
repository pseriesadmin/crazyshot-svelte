#!/usr/bin/env node
// 두발히어로 배송가능지역(서울·경기·인천) 우편번호 카탈로그 적재 + 시/군/구 배송 허용지역 등록 (Migration #703 이후).
//
//   Stage      : node --env-file=.env.local scripts/import-delivery-zipcodes.mjs
//   Production : SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/import-delivery-zipcodes.mjs --production
//
// · 데이터: supabase/seed/delivery_zipcodes.json (원본 엑셀 "서울경기인천_배송가능지역_필터링.xlsx", 우편번호는 5자리로 복원)
// · 카탈로그(delivery_area_zipcodes)는 우편번호 기준 upsert — 여러 번 실행해도 안전하다.
// · 허용지역(delivery_service_areas)에는 카탈로그의 시/군/구를 등록한다. 이미 있는 지역은 건너뛴다(기존 등록 보존).
//   --skip-areas 를 주면 카탈로그만 적재하고 허용지역은 건드리지 않는다.
// · 키 값은 출력하지 않는다. Stage 프로젝트가 아니면 --production 없이는 중단한다.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const STAGE_REF = 'ezyvffjvuwmtuhpxdjrw'
const PROD_REF = 'vnbpmvxruyciuuaermyh'

const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const production = process.argv.includes('--production')
const skipAreas = process.argv.includes('--skip-areas')

if (!url || !key) { console.error('SUPABASE_URL(또는 PUBLIC_SUPABASE_URL)과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.'); process.exit(1) }
const ref = new URL(url).hostname.split('.')[0]
if (ref === PROD_REF && !production) { console.error('운영 DB입니다. 의도한 것이면 --production 을 붙여 주세요.'); process.exit(1) }
if (ref !== PROD_REF && ref !== STAGE_REF) { console.error('알 수 없는 프로젝트입니다: ' + ref); process.exit(1) }
console.log('대상:', ref === PROD_REF ? 'Production' : 'Stage', skipAreas ? '(카탈로그만)' : '(카탈로그 + 허용지역)')

const rows = JSON.parse(readFileSync(new URL('../supabase/seed/delivery_zipcodes.json', import.meta.url), 'utf8'))
const sb = createClient(url, key, { auth: { persistSession: false } })

let done = 0
for (let i = 0; i < rows.length; i += 1000) {
  const chunk = rows.slice(i, i + 1000).map((r) => ({ postal_code: r.p, sido: r.sido, sigungu: r.sigungu, dong: r.dong, group_name: r.group }))
  const { error } = await sb.from('delivery_area_zipcodes').upsert(chunk, { onConflict: 'postal_code' })
  if (error) { console.error('카탈로그 적재 실패:', error.message); process.exit(1) }
  done += chunk.length
}
console.log('카탈로그 적재:', done, '건')

if (!skipAreas) {
  const regions = [...new Map(rows.map((r) => [`${r.sido}|${r.sigungu}`, { sido: r.sido, sigungu: r.sigungu }])).values()]
  let added = 0, dup = 0
  for (const r of regions) {
    const { data, error } = await sb.rpc('cms_add_delivery_area', { p_sido: r.sido, p_sigungu: r.sigungu, p_lat: null, p_lng: null, p_user_id: null, p_postal_code: null })
    if (error) { console.error('허용지역 등록 실패:', r.sido, r.sigungu, error.message); process.exit(1) }
    if (data?.ok) added++
    else if (data?.error === 'duplicate') dup++
    else { console.error('허용지역 등록 거절:', r.sido, r.sigungu, data?.error); process.exit(1) }
  }
  console.log(`허용지역 등록: 신규 ${added}곳, 기존 ${dup}곳 유지 (총 ${regions.length}곳)`)
}
