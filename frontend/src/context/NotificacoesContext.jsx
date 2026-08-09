import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { API } from '../lib/api';
import { useAuth } from './AuthContext';

const NotifCtx = createContext(null);
export const useNotificacoes = () => useContext(NotifCtx);

export function NotificacoesProvider({ children }) {
  const { usuario } = useAuth();
  const [notificacoes, setNotificacoes] = useState([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const timer = useRef(null);

  const recarregar = useCallback(async () => {
    try {
      const r = await API.get('/api/notificacoes');
      setNaoLidas(r.nao_lidas);
      setNotificacoes(r.notificacoes);
    } catch (_) { /* ignora */ }
  }, []);

  useEffect(() => {
    if (!usuario) { setNotificacoes([]); setNaoLidas(0); return; }
    recarregar();
    timer.current = setInterval(recarregar, 20000);
    return () => clearInterval(timer.current);
  }, [usuario, recarregar]);

  const marcarLida = useCallback(async (id) => {
    await API.patch(`/api/notificacoes/${id}/lida`);
    await recarregar();
  }, [recarregar]);

  const marcarTodas = useCallback(async () => {
    await API.patch('/api/notificacoes/ler-todas');
    await recarregar();
  }, [recarregar]);

  return (
    <NotifCtx.Provider value={{ notificacoes, naoLidas, recarregar, marcarLida, marcarTodas }}>
      {children}
    </NotifCtx.Provider>
  );
}
