import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cada teste comeca com a tela limpa e sem sobras de mock.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

// O jsdom nao implementa isto, e o chat usa para rolar ate a ultima mensagem.
Element.prototype.scrollIntoView = vi.fn();
