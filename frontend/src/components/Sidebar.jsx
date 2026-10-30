import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useChat } from '../context/ChatContext';
import { useToast } from '../context/ToastContext';
import { API } from '../lib/api';
import Avatar from './Avatar';

const ICONES = {
  visao: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>,
  kanban: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="6" height="18" rx="1" /><rect x="10" y="3" width="6" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" /></svg>,
  calendario: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>,
  clientes: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>,
  'calendario-equipe': <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M8 14l2 2 4-4" /></svg>,
  datas: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4L12 17l-6.3 4.4L8 14 2 9.4h7.6z" /></svg>,
  historico: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v6h6" /><path d="M3.5 9a9 9 0 1 0 2.1-3.4L3 9" /><path d="M12 7v5l4 2" /></svg>,
  chat: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z" /></svg>,
  briefing: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3v2h6V3M9 10h6M9 14h6M9 18h3" /></svg>,
  prompts: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 17l6-5-6-5M12 19h8" /></svg>,
  mensagens: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>,
  acessos: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  usuarios: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="7" r="4" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></svg>,
};

const NAV = [
  { view: 'visao', rot: 'Visão geral' },
  { view: 'kanban', rot: 'Kanban' },
  { view: 'calendario', rot: 'Calendário' },
  { view: 'calendario-equipe', rot: 'Calendário da Equipe' },
  { view: 'chat', rot: 'Chat' },
  { view: 'clientes', rot: 'Clientes' },
  { view: 'briefing', rot: 'Briefing' },
  { view: 'prompts', rot: 'Prompts' },
  { view: 'mensagens', rot: 'Mensagens' },
  { view: 'datas', rot: 'Datas Comemorativas', restrito: 'datas' },
  { view: 'acessos', rot: 'Cofre de acessos', restrito: 'admin' },
  { view: 'usuarios', rot: 'Usuários', restrito: 'admin' },
  { view: 'historico', rot: 'Histórico', restrito: 'admin' },
];

const VIEWS_SHARED = ['clientes', 'calendario-equipe', 'chat', 'briefing', 'prompts', 'mensagens',
  'datas', 'acessos', 'historico', 'usuarios'];

export default function Sidebar({ aberta, onFechar }) {
  const { usuario, ehAdmin, ehCriativo } = useAuth();
  const { setores, setorAtivo, setSetorAtivo } = useApp();
  const { naoLidas: chatNaoLidas } = useChat();
  const nav = useNavigate();
  const loc = useLocation();
  const viewAtual = loc.pathname.replace('/', '') || 'kanban';

  const podeVer = (item) => {
    if (item.restrito === 'datas') return ehAdmin || ehCriativo;
    if (item.restrito === 'admin') return ehAdmin;
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
            {item.view === 'chat' && chatNaoLidas > 0 && (
              <span className="nav-badge" aria-label={`${chatNaoLidas} mensagens não lidas`}>{chatNaoLidas > 99 ? '99+' : chatNaoLidas}</span>
            )}
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
        <MinhaFoto />
        <div className="meta">
          <b>{usuario?.nome}</b>
          <span>{usuario?.setor_nome}{ehAdmin ? ' · Admin' : ''}</span>
        </div>
        <LogoutBtn />
      </div>
    </aside>
  );
}

/* Foto de perfil: o clique abre um menuzinho para colocar, trocar ou remover. */
function MinhaFoto() {
  const { usuario, recarregarUsuario } = useAuth();
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const entrada = useRef(null);
  const raiz = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  async function enviar(arquivo) {
    if (arquivo.size > 3 * 1024 * 1024) { toast('A foto pode ter no máximo 3MB', 'erro'); return; }
    const fd = new FormData();
    fd.append('foto', arquivo);
    try { await API.post('/api/equipe/eu/avatar', fd, true); await recarregarUsuario(); toast('Foto atualizada ✓', 'ok'); }
    catch (e) { toast(e.message, 'erro'); }
  }

  async function remover() {
    setAberto(false);
    try { await API.del('/api/equipe/eu/avatar'); await recarregarUsuario(); toast('Foto removida', 'ok'); }
    catch (e) { toast(e.message, 'erro'); }
  }

  return (
    <div className="minha-foto" ref={raiz}>
      <button className="minha-foto-btn" onClick={() => setAberto((v) => !v)} title="Sua foto de perfil" aria-label="Foto de perfil">
        <Avatar pessoa={usuario} />
      </button>
      <input
        ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" hidden
        onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) enviar(a); }}
      />
      {aberto && (
        <div className="minha-foto-menu" role="menu">
          <button role="menuitem" onClick={() => { setAberto(false); entrada.current?.click(); }}>
            {usuario?.avatar_path ? 'Trocar foto' : 'Colocar foto'}
          </button>
          {usuario?.avatar_path && <button role="menuitem" onClick={remover}>Remover foto</button>}
        </div>
      )}
    </div>
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
