-- ★ MIGRATION: 02_enums.sql
-- Schema version: v5.46
-- Description: Global enum types for Crazyshot database
-- Dependencies: 01_extensions.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

-- Product category
CREATE TYPE product_category_enum AS ENUM (
  'camera', 'lens', 'camcorder', 'action_cam', 'drone',
  'lighting', 'audio', 'accessory', 'package'
);

-- Asset status (physical inventory)
CREATE TYPE asset_status_enum AS ENUM (
  'available', 'rented', 'hold', 'maintenance', 'retired', 'inspection'
);

-- Duration type for pricing
CREATE TYPE duration_type_enum AS ENUM (
  '12h', '24h', 'purchase', 'monthly'
);

-- Rental reservation status
CREATE TYPE reservation_status_enum AS ENUM (
  'hold', 'confirmed', 'in_use', 'returned', 'cancelled',
  'overdue', 'damaged', 'disputed'
);

-- Payment status
CREATE TYPE payment_status_enum AS ENUM (
  'pending', 'completed', 'failed', 'refunded', 'partial_refund'
);

-- Shipment method (배송방식)
CREATE TYPE shipment_method_enum AS ENUM (
  'crazydelivery', 'quick', 'locker', 'visit', 'airport'
);

-- Shipment status
CREATE TYPE shipment_status_enum AS ENUM (
  'preparing', 'shipped', 'in_transit', 'delivered', 'pickup_ready', 'failed'
);

-- Membership grade (등급)
CREATE TYPE membership_grade_enum AS ENUM (
  'none', 'easy', 'pop', 'crazy', 'admin'
);

-- Coupon type
CREATE TYPE coupon_type_enum AS ENUM (
  'all', 'first_purchase', 'student', 'subscription'
);

-- Product option type
CREATE TYPE option_type_enum AS ENUM (
  'accessory', 'service', 'bundle'
);

-- Contract status (전자계약서)
CREATE TYPE contract_status_enum AS ENUM (
  'active', 'completed', 'cancelled'
);

-- Inspection type (검수)
CREATE TYPE inspection_type_enum AS ENUM (
  'pre_rental', 'post_rental'
);

-- Subscription status
CREATE TYPE subscription_status_enum AS ENUM (
  'active', 'cancelled', 'expired', 'paused'
);

-- Helper function for auto-updating timestamps
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND membership_grade = 'admin'
  );
$$;
