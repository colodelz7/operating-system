import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: o Vite serve o front em :5173 e faz proxy de /api para o backend
// em :3000. Isso evita CORS e mantem o cookie de sessao (mesma origem
// do ponto de vista do navegador). Em producao, o build (dist/) e
// servido no mesmo dominio que expoe /api.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist' },
});
