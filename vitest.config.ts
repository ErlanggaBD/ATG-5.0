import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Default 5 detik terlalu ketat untuk render jsdom di mesin yang
    // menjalankan beberapa file test sekaligus. Test yang merender seluruh
    // App (13 titik uji + tabel + visualizer) sudah memakan ~4-5 detik
    // sendirian, jadi tanpa headroom ini suite sesekali gagal karena timeout,
    // bukan karena ada yang benar-benar salah. Timeout lebih besar hanya
    // memberi waktu; tidak membuat test yang gagal jadi lulus.
    testTimeout: 20000,
  },
});