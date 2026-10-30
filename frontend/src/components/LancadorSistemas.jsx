import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

/* Botao flutuante "Trocar de sistema": atalhos para os outros sistemas da
   empresa (comercial, financeiro, etc.).

   A lista vem de VITE_SISTEMAS no .env do frontend, em JSON:
     [{"nome":"Sistema Comercial","descricao":"Vendas e contratos",
       "url":"https://comercial.exemplo.com","setores":["comercial"]}]
   "setores" e opcional: sem ele, todos veem; com ele, so quem e daqueles
   setores (pelo slug). O admin ve todos. Sem a variavel, o botao nao aparece.
   So entra endereco https, para ninguem transformar o atalho em link perigoso. */

function lerSistemas() {
  let lista = [];
  try { lista = JSON.parse(import.meta.env.VITE_SISTEMAS || '[]'); } catch (_) { return []; }
  if (!Array.isArray(lista)) return [];
  return lista.filter((s) => {
    if (!s || typeof s.nome !== 'string' || typeof s.url !== 'string') return false;
    try { return new URL(s.url).protocol === 'https:'; } catch (_) { return false; }
  });
}

const SISTEMAS = lerSistemas();

export default function LancadorSistemas() {
  const { usuario, ehAdmin } = useAuth();
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);

  const meus = SISTEMAS.filter((s) => ehAdmin || !Array.isArray(s.setores) || !s.setores.length
    || s.setores.includes(usuario?.setor_slug));

  // fecha ao clicar fora ou apertar Esc (so enquanto aberto)
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  if (!usuario || !meus.length) return null;

  return (
    <div className="lancador" ref={raiz}>
      {aberto && (
        <div className="lancador-painel" role="menu">
          <p className="lancador-titulo">Trocar de sistema</p>
          {meus.map((s) => (
            <a key={s.url} className="lancador-item" href={s.url} target="_blank" rel="noopener noreferrer" role="menuitem">
              <span className="lancador-ico" aria-hidden="true">{s.nome.trim()[0]}</span>
              <span className="lancador-texto"><b>{s.nome}</b>{s.descricao && <small>{s.descricao}</small>}</span>
              <svg className="lancador-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true"><path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>
            </a>
          ))}
          <p className="lancador-aqui">Você está no Sistema Operacional</p>
        </div>
      )}
      <button className="lancador-botao" aria-expanded={aberto} aria-label="Trocar de sistema" title="Trocar de sistema" onClick={() => setAberto((v) => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>
      </button>
    </div>
  );
}
