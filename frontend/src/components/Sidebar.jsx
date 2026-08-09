import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { iniciais } from '../lib/format';

const ICONES = {
  visao: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>,
  kanban: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="6" height="18" rx="1" /><rect x="10" y="3" width="6" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" /></svg>,
  calendario: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>,
  clientes: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>,
  'calendario-equipe': <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M8 14l2 2 4-4" /></svg>,
  datas: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4L12 17l-6.3 4.4L8 14 2 9.4h7.6z" /></svg>,
  historico: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v6h6" /><path d="M3.5 9a9 9 0 1 0 2.1-3.4L3 9" /><path d="M12 7v5l4 2" /></svg>,
  usuarios: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="7" r="4" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></svg>,
};

const NAV = [
  { view: 'visao', rot: 'Visão geral' },
  { view: 'kanban', rot: 'Kanban' },
  { view: 'calendario', rot: 'Calendário' },
  { view: 'clientes', rot: 'Clientes' },
  { view: 'calendario-equipe', rot: 'Calendário da Equipe' },
  { view: 'datas', rot: 'Datas Comemorativas', restrito: 'datas' },
  { view: 'usuarios', rot: 'Usuários', restrito: 'usuarios' },
  { view: 'historico', rot: 'Histórico', restrito: 'historico' },
];

const VIEWS_SHARED = ['clientes', 'calendario-equipe', 'datas', 'historico', 'usuarios'];

export default function Sidebar({ aberta, onFechar }) {
  const { usuario, ehAdmin, ehCriativo } = useAuth();
  const { setores, setorAtivo, setSetorAtivo } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const viewAtual = loc.pathname.replace('/', '') || 'kanban';

  const podeVer = (item) => {
    if (item.restrito === 'datas') return ehAdmin || ehCriativo;
    if (item.restrito === 'historico') return ehAdmin;
    if (item.restrito === 'usuarios') return ehAdmin;
    return true;
  };

  const irView = (view) => { onFechar(); nav('/' + view); };

  const escolherSetor = (id) => {
    onFechar();
    setSetorAtivo(id);
    if (ehAdmin) { nav('/visao'); return; }
    // membro: mantem a view atual, exceto nas telas compartilhadas
    if (!VIEWS_SHARED.includes(viewAtual)) nav('/' + viewAtual);
  };

  const escolherTodos = () => { onFechar(); setSetorAtivo('todos'); nav('/visao'); };

  const todosAtivo = ehAdmin && viewAtual === 'visao' && setorAtivo === 'todos';

  return (
    <aside className={`sidebar ${aberta ? 'aberta' : ''}`} id="sidebar">
      <button className="logo" onClick={() => { onFechar(); nav('/visao'); }} title="Ir para a visão geral">
        Colodel<span className="dot" />
      </button>

      <nav className="nav" id="nav-principal">
        {NAV.filter(podeVer).map((item) => (
          <button key={item.view} className={viewAtual === item.view ? 'ativo' : ''} onClick={() => irView(item.view)}>
            {ICONES[item.view]}
            {item.rot}
          </button>
        ))}
      </nav>

      <div className="side-setores">
        <div className="side-group-label">Setores</div>
        <div id="lista-setores">
          {ehAdmin && (
            <button className={`setor-item ${todosAtivo ? 'ativo' : ''}`} onClick={escolherTodos}>
              <span className="setor-dot" style={{ background: 'linear-gradient(135deg,var(--brand),var(--neon))' }} />
              Todos
            </button>
          )}
          {setores.map((s) => {
            const ativo = s.id === setorAtivo && !todosAtivo;
            return (
              <button key={s.id} className={`setor-item ${ativo ? 'ativo' : ''}`} onClick={() => escolherSetor(s.id)}>
                <span className="setor-dot" style={{ background: s.cor }} />
                {s.nome}
              </button>
            );
          })}
        </div>
      </div>

      <div className="side-user">
        <div className="avatar" id="user-avatar">{iniciais(usuario?.nome)}</div>
        <div className="meta">
          <b>{usuario?.nome}</b>
          <span>{usuario?.setor_nome}{ehAdmin ? ' · Admin' : ''}</span>
        </div>
        <LogoutBtn />
      </div>
    </aside>
  );
}

function LogoutBtn() {
  const { logout } = useAuth();
  const nav = useNavigate();
  const sair = async () => { await logout(); nav('/login'); };
  return (
    <button className="sair" onClick={sair} title="Sair">
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
    </button>
  );
}
