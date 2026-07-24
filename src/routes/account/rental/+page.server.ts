import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export interface MyRental {
  id:               string
  status:           string
  reservation_code: string
  start_date:       string | null
  end_date:         string | null
  created_at:       string
  product_name:     string | null
  product_category: string | null
}

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const { data, error } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, created_at, orders(order_items(products(name, category)))')
    .eq('user_id', session.user.id)
    .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return { rentals: [] as MyRental[] }
  }

  const rentals: MyRental[] = (data ?? []).map((r: Record<string, unknown>) => {
    const orders = r.orders as Array<{ order_items: Array<{ products: { name: string; category: string } | null }> }> | null
    const firstProduct = orders?.[0]?.order_items?.[0]?.products ?? null
    return {
      id:               r.id as string,
      status:           r.status as string,
      reservation_code: r.reservation_code as string,
      start_date:       r.start_date as string | null,
      end_date:         r.end_date as string | null,
      created_at:       r.created_at as string,
      product_name:     firstProduct?.name ?? null,
      product_category: firstProduct?.category ?? null,
    }
  })

  return { rentals }
}
