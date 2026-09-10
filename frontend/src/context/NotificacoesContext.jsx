import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { API } from '../lib/api';
import { useAuth } from './AuthContext';

const NotifCtx = createContext(null);
export const useNotificacoes = () => useContext(NotifCtx);

/* As notificações chegam por SSE (/api/notificacoes/stream): o servidor avisa
   na hora em que algo nasce, em vez de o navegador perguntar de tempo em
   tempo. Se a conexão não abrir (proxy antigo, rede chata), cai para uma
   consulta a cada 60 segundos, que ainda é três vezes menos requisição do que
   o intervalo de 20s de antes. */

const INTERVALO_RESERVA_MS = 60000;

export function NotificacoesProvider({ children }) {
  const { usuario } = useAuth();
  const [notificacoes, setNotificacoes] = useState([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [aoVivo, setAoVivo] = useState(false);
  const timer = useRef(null);
  const fonte = useRef(null);

  const recarregar = useCallback(async () => {
    try {
      const r = await API.get('/api/notificacoes');
      setNaoLidas(r.nao_lidas);
      setNotificacoes(r.notificacoes);
    } catch (_) { /* ignora: a próxima tentativa resolve */ }
  }, []);

  useEffect(() => {
    if (!usuario) {
      setNotificacoes([]); setNaoLidas(0); setAoVivo(false);
      return undefined;
    }

    recarregar();

    const ligarReserva = () => {
      if (timer.current) return;
      timer.current = setInterval(recarregar, INTERVALO_RESERVA_MS);
    };
    const desligarReserva = () => {
      if (!timer.current) return;
      clearInterval(timer.current);
      timer.current = null;
    };

    if (typeof EventSource === 'undefined') {
      ligarReserva();
      return () => desligarReserva();
    }

    const es = new EventSource('/api/notificacoes/stream', { withCredentials: true });
    fonte.current = es;

    es.addEventListener('pronto', () => { setAoVivo(true); desligarReserva(); });
    es.addEventListener('atualizar', () => { recarregar(); });
    es.addEventListener('error', () => {
      // o navegador tenta reconectar sozinho; enquanto isso, consulta periódica
      setAoVivo(false);
      ligarReserva();
    });

    return () => {
      es.close();
      fonte.current = null;
      desligarReserva();
    };
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
    <NotifCtx.Provider value={{ notificacoes, naoLidas, aoVivo, recarregar, marcarLida, marcarTodas }}>
      {children}
    </NotifCtx.Provider>
  );
}
