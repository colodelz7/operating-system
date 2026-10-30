import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import { useAuth } from './AuthContext';
import { isoLocal } from '../lib/format';

const AgendaCtx = createContext(null);
export const useAgenda = () => useContext(AgendaCtx) || { eventosHoje: [], recarregar: () => {} };

/* Eventos de HOJE do Calendario da Equipe, para o aviso no topo da tela.
   "Hoje" e o dia do navegador (nao o do servidor, que pode estar em UTC).
   Eventos sao do dia: consultar a cada 5 minutos e ao voltar para a aba basta. */

const INTERVALO_MS = 5 * 60 * 1000;

export function AgendaProvider({ children }) {
  const { usuario } = useAuth();
  const [eventosHoje, setEventosHoje] = useState([]);

  const recarregar = useCallback(async () => {
    const hoje = isoLocal();
    try { setEventosHoje((await API.get(`/api/eventos?de=${hoje}&ate=${hoje}`)).eventos || []); }
    catch (_) { /* silencioso: o aviso so some */ }
  }, []);

  useEffect(() => {
    if (!usuario) { setEventosHoje([]); return undefined; }
    recarregar();
    const timer = setInterval(recarregar, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === 'visible') recarregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [usuario, recarregar]);

  return <AgendaCtx.Provider value={{ eventosHoje, recarregar }}>{children}</AgendaCtx.Provider>;
}
