export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          condition: string
          created_at: string | null
          id: number
          notes: string | null
          product_id: number
          purchase_date: string | null
          purchase_price: number | null
          serial_number: string
          status: string
          updated_at: string | null
        }
        Insert: {
          condition?: string
          created_at?: string | null
          id?: number
          notes?: string | null
          product_id: number
          purchase_date?: string | null
          purchase_price?: number | null
          serial_number: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          condition?: string
          created_at?: string | null
          id?: number
          notes?: string | null
          product_id?: number
          purchase_date?: string | null
          purchase_price?: number | null
          serial_number?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string | null
          id: number
          line_total: number
          order_id: number
          product_id: number
          quantity: number
          reservation_id: number | null
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: number
          line_total: number
          order_id: number
          product_id: number
          quantity?: number
          reservation_id?: number | null
          unit_price: number
        }
        Update: {
          created_at?: string | null
          id?: number
          line_total?: number
          order_id?: number
          product_id?: number
          quantity?: number
          reservation_id?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "rental_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          discount_amount: number | null
          final_amount: number
          id: number
          order_key: string
          status: string
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          discount_amount?: number | null
          final_amount: number
          id?: number
          order_key: string
          status?: string
          tax_amount?: number | null
          total_amount: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          discount_amount?: number | null
          final_amount?: number
          id?: number
          order_key?: string
          status?: string
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          created_at: string | null
          id: number
          method: string
          order_id: number
          payment_key: string
          provider_response: Json | null
          status: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: number
          method: string
          order_id: number
          payment_key: string
          provider_response?: Json | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: number
          method?: string
          order_id?: number
          payment_key?: string
          provider_response?: Json | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          base_price_daily: number
          base_price_monthly: number
          base_price_weekly: number
          category: string
          code: string
          created_at: string | null
          description: string | null
          id: number
          name: string
          status: string
          updated_at: string | null
        }
        Insert: {
          base_price_daily: number
          base_price_monthly: number
          base_price_weekly: number
          category: string
          code: string
          created_at?: string | null
          description?: string | null
          id?: number
          name: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          base_price_daily?: number
          base_price_monthly?: number
          base_price_weekly?: number
          category?: string
          code?: string
          created_at?: string | null
          description?: string | null
          id?: number
          name?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      rental_reservations: {
        Row: {
          asset_id: number | null
          created_at: string | null
          end_date: string
          id: number
          notes: string | null
          product_id: number
          rental_days: number | null
          start_date: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_id?: number | null
          created_at?: string | null
          end_date: string
          id?: number
          notes?: string | null
          product_id: number
          rental_days?: number | null
          start_date: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_id?: number | null
          created_at?: string | null
          end_date?: string
          id?: number
          notes?: string | null
          product_id?: number
          rental_days?: number | null
          start_date?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_reservations_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_reservations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          created_at: string | null
          delivered_at: string | null
          id: number
          order_id: number
          return_date: string | null
          shipped_at: string | null
          status: string
          tracking_number: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          delivered_at?: string | null
          id?: number
          order_id: number
          return_date?: string | null
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          delivered_at?: string | null
          id?: number
          order_id?: number
          return_date?: string | null
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string | null
          description: string | null
          discount_rate: number
          features: Json | null
          id: number
          max_monthly_rental_days: number | null
          name: string
          status: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          discount_rate?: number
          features?: Json | null
          id?: number
          max_monthly_rental_days?: number | null
          name: string
          status?: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          discount_rate?: number
          features?: Json | null
          id?: number
          max_monthly_rental_days?: number | null
          name?: string
          status?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          is_student: boolean | null
          phone: string | null
          postal_code: string | null
          status: string
          updated_at: string | null
          verified_at: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          email: string
          full_name?: string | null
          id: string
          is_student?: boolean | null
          phone?: string | null
          postal_code?: string | null
          status?: string
          updated_at?: string | null
          verified_at?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_student?: boolean | null
          phone?: string | null
          postal_code?: string | null
          status?: string
          updated_at?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          cancelled_at: string | null
          created_at: string | null
          expires_at: string | null
          id: number
          plan_id: number
          started_at: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: number
          plan_id: number
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: number
          plan_id?: number
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      atomic_reserve_asset: {
        Args: { p_end_date: string; p_product_id: number; p_start_date: string }
        Returns: {
          asset_id: number
          error_message: string
          reservation_id: number
          success: boolean
        }[]
      }
      batch_atomic_reserve: {
        Args: { p_product_assets: Json }
        Returns: {
          asset_id: number
          error_message: string
          reservation_id: number
          success: boolean
        }[]
      }
      calculate_cart_total: {
        Args: { p_reservation_ids: number[] }
        Returns: {
          discount_amount: number
          final_amount: number
          total_amount: number
        }[]
      }
      cancel_subscription: {
        Args: { p_subscription_id: number }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      confirm_payment: {
        Args: {
          p_order_id: number
          p_payment_key: string
          p_provider_response: Json
        }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      ensure_user_profile: { Args: never; Returns: string }
      process_payment_and_create_order: {
        Args: {
          p_amount: number
          p_payment_key: string
          p_payment_method: string
          p_reservation_ids: number[]
        }
        Returns: {
          error_message: string
          order_id: number
          payment_transaction_id: number
          success: boolean
        }[]
      }
      release_asset: {
        Args: { p_reservation_id: number }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      subscribe_plan: {
        Args: { p_plan_id: number }
        Returns: {
          error_message: string
          subscription_id: number
          success: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
