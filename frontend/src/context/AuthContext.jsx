import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const carregarMe = useCallback(async () => {
    try {
      const r = await API.get('/api/auth/me');
      setUsuario(r.usuario);
      return r.usuario;
    } catch (_) {
      setUsuario(null);
      return null;
    }
  }, []);

  useEffect(() => { carregarMe().finally(() => setCarregando(false)); }, [carregarMe]);

  const login = useCallback(async (u, senha) => {
    await API.post('/api/auth/login', { usuario: u, senha });
    return carregarMe();
  }, [carregarMe]);

  const logout = useCallback(async () => {
    try { await API.post('/api/auth/logout'); } catch (_) { /* ignora */ }
    setUsuario(null);
  }, []);

  const ehAdmin = usuario?.papel === 'admin';
  const ehCriativo = usuario ? (usuario.setor_slug === 'criativo' || usuario.setor_nome === 'Criativo') : false;

  return (
    <AuthCtx.Provider value={{ usuario, carregando, ehAdmin, ehCriativo, login, logout, recarregarUsuario: carregarMe }}>
      {children}
    </AuthCtx.Provider>
  );
}
