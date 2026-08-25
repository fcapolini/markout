<script setup vapor lang="ts">
import CartLineRow from './CartLine.vue';
import type { CartLineData } from '../types';
defineProps<{ lines: CartLineData[]; total: number }>();
defineEmits<{ bump: [id: string, step: number]; drop: [id: string]; clear: [] }>();
</script>

<template>
  <aside class="cart">
    <header class="cart-head">
      <h2>Cart</h2>
      <button class="ghost" :disabled="lines.length === 0" @click="$emit('clear')">Clear</button>
    </header>
    <p v-if="lines.length === 0" class="cart-empty">Nothing yet &mdash; add something from the catalog.</p>
    <ul class="cart-lines">
      <CartLineRow
        v-for="line in lines"
        :key="line.id"
        :line="line"
        @bump="(id, step) => $emit('bump', id, step)"
        @drop="(id) => $emit('drop', id)"
      />
    </ul>
    <footer class="cart-foot">
      <span>Total</span>
      <strong>${{ total }}</strong>
    </footer>
  </aside>
</template>
