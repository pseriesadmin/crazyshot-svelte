<script lang="ts">
  import type { Product, CartItem } from '$lib/types/database';
  import { priceConfig } from '$lib/fixtures/cartFixtures';

  interface Props {
    product: Product;
    cartItem: CartItem;
  }

  let { product, cartItem }: Props = $props();

  // 렌탈료 계산 ($derived: props 변경 시 재계산)
  let rentalDays = $derived(Math.ceil(
    (new Date(cartItem.rental_end_date).getTime() -
     new Date(cartItem.rental_start_date).getTime()) /
    (1000 * 60 * 60 * 24)
  ));

  let priceInfo = $derived(priceConfig[product.id as keyof typeof priceConfig]);
  let rentalFee = $derived(priceInfo ? priceInfo.daily_rate * rentalDays : 0);
</script>

<div class="product-card">
  <div class="card-image">
    <img 
      src={product.image_urls?.[0] || 'https://res.cloudinary.com/crazyshot/image/upload/w_400,h_300,c_fill,f_auto,q_auto/placeholder.jpg'}
      alt={product.name}
      width="400"
      height="300"
      loading="lazy"
    />
  </div>

  <div class="card-content">
    <h3 class="product-name">{product.name}</h3>
    
    {#if product.brand}
      <p class="product-brand">{product.brand}</p>
    {/if}

    <div class="rental-info">
      <span class="dates">
        {new Date(cartItem.rental_start_date).toLocaleDateString()} ~ 
        {new Date(cartItem.rental_end_date).toLocaleDateString()}
      </span>
      <span class="days">({rentalDays}일)</span>
    </div>

    <div class="price-section">
      <div class="rental-fee">
        <span class="label">렌탈료</span>
        <span class="amount">₩{rentalFee.toLocaleString()}</span>
      </div>
      <div class="quantity">
        <span class="label">수량</span>
        <span class="amount">×{cartItem.quantity}</span>
      </div>
    </div>
  </div>
</div>

<style>
  .product-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-surface);
  }

  .card-image {
    width: 100%;
    padding-top: 75%;
    position: relative;
    overflow: hidden;
    background: var(--color-surface-alt);
  }

  .card-image img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .card-content {
    padding: var(--spacing-4);
  }

  .product-name {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .product-brand {
    margin: var(--spacing-2) 0 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .rental-info {
    margin: var(--spacing-3) 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .dates {
    display: block;
  }

  .days {
    margin-left: var(--spacing-1);
  }

  .price-section {
    margin-top: var(--spacing-3);
    padding-top: var(--spacing-3);
    border-top: 1px solid var(--color-border);
  }

  .rental-fee,
  .quantity {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-2);
  }

  .rental-fee .amount {
    font-weight: 600;
    color: var(--color-primary);
  }

  .label {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .amount {
    font-size: 0.875rem;
    color: var(--color-text);
  }
</style>
