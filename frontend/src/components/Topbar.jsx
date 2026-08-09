import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useNotificacoes } from '../context/NotificacoesContext';
import { useTarefaModal } from '../context/TarefaModalContext';

const TITULOS = {
  visao: 'Visão geral', kanban: 'Kanban', calendario: 'Calendário',
  clientes: 'Clientes', 'calendario-equipe': 'Calendário da Equipe',
  datas: 'Datas Comemorativas', historico: 'Histórico', usuarios: 'Usuários',
};
const SEM_NOVA = ['clientes', 'calendario-equipe', 'datas', 'historico', 'usuarios'];

export default function Topbar({ mostrarMenu, onAbrirMenu, onToggleTema, onToggleSino }) {
  const loc = useLocation();
  const view = loc.pathname.replace('/', '') || 'kanban';
  const { ehAdmin, setorAtivo, setorAtivoObj } = useApp();
  const { naoLidas } = useNotificacoes();
  const { abrirNova } = useTarefaModal();

  const setorNome = setorAtivoObj ? setorAtivoObj.nome : '';
  const contexto =
    view === 'clientes' ? ''
    : view === 'calendario-equipe' ? 'Agenda compartilhada de todos os setores'
    : view === 'datas' ? 'Calendário de marketing 2026'
    : view === 'historico' ? ''
    : view === 'visao' ? (ehAdmin ? 'Painel de controle' : setorNome)
    : setorNome;

  // "Nova tarefa" aparece em Visão geral, Kanban e Calendário. No modo
  // "Todos" também: o modal pede o setor primeiro (admin escolhe lá).
  const semNova = SEM_NOVA.includes(view);

  return (
    <header className="topbar">
      {mostrarMenu && (
        <button className="btn btn-ghost btn-sm" style={{ padding: 8 }} onClick={onAbrirMenu}>☰</button>
      )}
      <div>
        <h2>{TITULOS[view] || ''}</h2>
        <div className="contexto">{contexto}</div>
      </div>
      <div className="spacer" />

      {!semNova && (
        <button className="btn btn-primary" onClick={() => abrirNova({ setorId: setorAtivo })}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
          Nova tarefa
        </button>
      )}

      <button className="btn-icon" onClick={onToggleTema} title="Alternar tema claro/escuro" aria-label="Alternar tema">
        <svg className="ico moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
        <svg className="ico sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      </button>

      <button className="sino" onClick={(e) => { e.stopPropagation(); onToggleSino(); }} title="Notificações">
        <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        <span className={`badge ${naoLidas > 0 ? 'show' : ''}`}>{naoLidas}</span>
      </button>
    </header>
  );
}