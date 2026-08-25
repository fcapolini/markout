<script setup vapor lang="ts">
import Rating from './Rating.vue';
import type { Item } from '../types';
defineProps<{ item: Item; inCart: boolean }>();
defineEmits<{ buy: [item: Item] }>();
</script>

<template>
  <article class="card">
    <div class="card-media">
      <img :src="item.image" :alt="item.name" loading="lazy" />
      <span class="card-tag">{{ item.category }}</span>
    </div>
    <div class="card-body">
      <p class="card-brand">{{ item.brand }}</p>
      <h3 class="card-title">{{ item.name }}</h3>
      <Rating :score="item.rating" :count="item.reviews" />
      <ul class="card-specs">
        <li v-for="s in item.specs" :key="s">{{ s }}</li>
      </ul>
      <p :class="'card-stock' + (item.stock < 8 ? ' card-stock-low' : '')">
        {{ item.stock === 0 ? 'Back-ordered' : item.stock + ' in stock' }}
      </p>
      <div class="card-foot">
        <span class="card-price">${{ item.price }}</span>
        <button class="buy" :disabled="inCart" @click="$emit('buy', item)">{{ inCart ? 'In cart' : 'Add' }}</button>
      </div>
    </div>
  </article>
</template>
