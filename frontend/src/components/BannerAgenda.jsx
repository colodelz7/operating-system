import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAgenda } from '../context/AgendaContext';
import { isoLocal } from '../lib/format';

// Fechar o aviso vale so para hoje: amanha, eventos novos voltam a aparecer.
const chave = () => `colodel-agenda-fechada-${isoLocal()}`;
function lerFechado() {
  try { return localStorage.getItem(chave()) === '1'; } catch (_) { return false; }
}

/* Aviso discreto no topo: os eventos de hoje em que a pessoa participa, que
   ela criou ou que sao da equipe toda. */
export default function BannerAgenda() {
  const { usuario } = useAuth();
  const { eventosHoje } = useAgenda();
  const nav = useNavigate();
  const [fechado, setFechado] = useState(lerFechado);

  const meus = eventosHoje.filter((e) => e.setor_id == null || e.criado_por === usuario?.id
    || (e.participantes || []).some((p) => p.id === usuario?.id));
  if (fechado || !meus.length) return null;

  const fechar = () => {
    try { localStorage.setItem(chave(), '1'); } catch (_) { /* sem storage: fecha so agora */ }
    setFechado(true);
  };

  return (
    <div className="banner-agenda" role="status">
      <span className="ba-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
      </span>
      <button className="ba-lista" onClick={() => nav('/calendario-equipe')}>
        <b>Hoje:</b>{' '}
        {meus.slice(0, 3).map((e, i) => (
          <span key={e.id}>{i ? ' · ' : ''}{e.hora_inicio ? `${e.hora_inicio} ` : ''}{e.titulo}</span>
        ))}
        {meus.length > 3 && <span> e mais {meus.length - 3}</span>}
      </button>
      <button className="ba-fechar" onClick={fechar} aria-label="Fechar aviso de hoje">✕</button>
    </div>
  );
}
