<script lang="ts">
  interface Props {
    name: string
    price: string
    img: string
  }

  let { name, price, img }: Props = $props()
</script>

<div class="card-wrap">
  <div class="img-wrap">
    <img src={img} alt={name} class="card-img" />
  </div>
  <div class="card-info">
    <p class="card-name">{name}</p>
    <p class="card-price">{price}</p>
  </div>
</div>

<style>
  .card-wrap {
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.2s;
    min-width: 155px;
    text-decoration: none;
  }
  .card-wrap:hover {
    transform: scale(1.02);
  }
  .img-wrap {
    position: relative;
    width: 100%;
    height: 200px;
    border-radius: 20px 20px 0 0;
    overflow: hidden;
    background: #e1def3;
  }
  .card-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .card-info {
    padding: 5px 5px 10px;
  }
  .card-name {
    font-size: 16px;
    font-weight: 700;
    line-height: 1.6;
    letter-spacing: -0.5px;
    color: #1d183e;
    font-family: 'Noto Sans KR', sans-serif;
    margin: 0 0 2px;
  }
  .card-price {
    font-size: 14px;
    font-weight: 700;
    line-height: 2;
    letter-spacing: -0.5px;
    color: #3b2f8a;
    font-family: 'Noto Sans KR', sans-serif;
    margin: 0;
  }
</style>
