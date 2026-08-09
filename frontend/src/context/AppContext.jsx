import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import { FILTROS_VAZIOS } from '../lib/filtros';
import { useAuth } from './AuthContext';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const { usuario, ehAdmin } = useAuth();
  const [setores, setSetores] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [setorAtivo, setSetorAtivo] = useState(null);
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [refreshToken, setRefreshToken] = useState(0);
  const [carregando, setCarregando] = useState(true);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);
  const limparFiltros = useCallback(() => setFiltros(FILTROS_VAZIOS), []);

  const recarregarClientes = useCallback(async () => {
    try { setClientes((await API.get('/api/clientes')).clientes); } catch (_) { /* ignora */ }
  }, []);

  // carrega setores + clientes assim que ha usuario logado
  useEffect(() => {
    if (!usuario) { setSetores([]); setClientes([]); setSetorAtivo(null); return; }
    let vivo = true;
    (async () => {
      setCarregando(true);
      try {
        const r = await API.get('/api/setores');
        if (!vivo) return;
        setSetores(r.setores);
        let ativo = usuario.setor_id;
        if (!r.setores.some((s) => s.id === ativo) && r.setores.length) ativo = r.setores[0].id;
        setSetorAtivo(ativo);
      } catch (_) { /* ignora */ }
      await recarregarClientes();
      if (vivo) setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [usuario, recarregarClientes]);

  const setorAtivoObj = setores.find((s) => s.id === setorAtivo) || null;

  return (
    <AppCtx.Provider value={{
      setores, clientes, setorAtivo, setSetorAtivo, setorAtivoObj,
      filtros, setFiltros, limparFiltros,
      refreshToken, refresh, recarregarClientes, carregando, ehAdmin,
    }}>
      {children}
    </AppCtx.Provider>
  );
}
