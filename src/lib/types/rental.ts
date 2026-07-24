export interface ActionLog {
  type:         string
  performed_at: string
  note:         string | null
}

export interface ActiveRentalRow {
  reservation_id:    number
  reservation_code:  string
  status:            string
  rental_start:      string
  rental_end:        string
  rental_days:       number | null
  pickup_method:     string | null
  return_method:     string | null
  pickup_time:       string | null
  return_time:       string | null
  user_id:           string
  customer_name:     string
  customer_phone:    string | null
  product_name:      string
  product_code:      string | null
  product_category:  string
  product_image_url: string | null
  action_logs:       ActionLog[]
  total_count:       number
}
