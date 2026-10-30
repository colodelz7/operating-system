import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import { useAuth } from './AuthContext';

const ChatCtx = createContext(null);
export const useChat = () => useContext(ChatCtx) || { naoLidas: 0, recarregar: () => {} };

/* Contador de mensagens nao lidas do chat (o numerinho do menu).
   Atualiza na hora pelo aviso 'colodel:chat' (que chega pelo SSE das
   notificacoes) e, por garantia, a cada 60s se o SSE estiver fora. */

const INTERVALO_RESERVA_MS = 60000;

export function ChatProvider({ children }) {
  const { usuario } = useAuth();
  const [naoLidas, setNaoLidas] = useState(0);

  const recarregar = useCallback(async () => {
    try { setNaoLidas((await API.get('/api/chat/resumo')).nao_lidas || 0); }
    catch (_) { /* a proxima tentativa resolve */ }
  }, []);

  useEffect(() => {
    if (!usuario) { setNaoLidas(0); return undefined; }
    recarregar();
    const aoAviso = () => recarregar();
    window.addEventListener('colodel:chat', aoAviso);
    const timer = setInterval(recarregar, INTERVALO_RESERVA_MS);
    return () => {
      window.removeEventListener('colodel:chat', aoAviso);
      clearInterval(timer);
    };
  }, [usuario, recarregar]);

  return <ChatCtx.Provider value={{ naoLidas, recarregar }}>{children}</ChatCtx.Provider>;
}
