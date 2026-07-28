import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { error, redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: signing, error: signingErr } = await admin
    .from('contract_signings')
    .select(`
      id,
      token,
      sent_at,
      viewed_at,
      signed_at,
      expires_at,
      contracts (
        id,
        title,
        content_blocks,
        specifications,
        document_url,
        reservation_id,
        rental_reservations (
          id,
          start_date,
          end_date,
          reservation_code,
          user_id,
          products ( name, category )
        )
      )
    `)
    .eq('token', params.token)
    .maybeSingle()

  if (signingErr || !signing) {
    throw error(404, '유효하지 않은 계약서 링크입니다.')
  }

  if (signing.signed_at) {
    throw redirect(302, '/contract/signed')
  }

  if (signing.expires_at && new Date(signing.expires_at) < new Date()) {
    throw redirect(302, '/contract/expired')
  }

  // viewed_at 최초 기록
  if (!signing.viewed_at) {
    await admin
      .from('contract_signings')
      .update({ viewed_at: new Date().toISOString() })
      .eq('id', signing.id)
  }

  const reservation = (signing.contracts as unknown as {
    rental_reservations: { user_id: string } | null
  } | null)?.rental_reservations

  let customer: { full_name: string | null; phone: string | null; email: string | null } | null = null
  if (reservation?.user_id) {
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name, phone, email')
      .eq('id', reservation.user_id)
      .maybeSingle()
    customer = profile
  }

  return { signing, customer }
}
