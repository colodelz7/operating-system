import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: o Vite serve o front em :5174 e faz proxy de /api para o backend
// em :3001. (5173 e 3000 costumam estar ocupadas por outros projetos.) Isso evita CORS e mantem o cookie de sessao (mesma origem
// do ponto de vista do navegador). Em producao, o build (dist/) e
// servido no mesmo dominio que expoe /api.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist' },
  test: {
    // happy-dom no lugar do jsdom: mais leve e sem o conflito de modulos
    // que o jsdom tem com o parser de CSS nesta versao do Node.
    environment: 'happy-dom',
    globals: false,
    setupFiles: './src/teste/setup.js',
    css: false,
    include: ['src/**/*.test.{js,jsx}'],
  },
});
