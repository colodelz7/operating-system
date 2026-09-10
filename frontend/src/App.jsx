import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import AssistenteColodelBot from './components/AssistenteColodelBot';
import { useApp } from './context/AppContext';
import { useNotificacoes } from './context/NotificacoesContext';
import { useTarefaModal } from './context/TarefaModalContext';
import { API } from './lib/api';
import { formatarQuando } from './lib/format';

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const aplica = () => setMobile(mq.matches);
    mq.addEventListener('change', aplica);
    return () => mq.removeEventListener('change', aplica);
  }, []);
  return mobile;
}

export default function App() {
  const mobile = useIsMobile();
  const [sidebarAberta, setSidebarAberta] = useState(false);
  const [sinoAberto, setSinoAberto] = useState(false);

  useEffect(() => { if (!mobile) setSidebarAberta(false); }, [mobile]);

  const alternarTema = () => {
    const atual = document.documentElement.getAttribute('data-theme') || 'dark';
    const novo = atual === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', novo);
    localStorage.setItem('colodel-tema', novo);
  };

  return (
    <>
      <div className="app">
        <Sidebar aberta={sidebarAberta} onFechar={() => setSidebarAberta(false)} />
        <div className="main">
          <Topbar
            mostrarMenu={mobile}
            onAbrirMenu={() => setSidebarAberta((v) => !v)}
            onToggleTema={alternarTema}
            onToggleSino={() => setSinoAberto((v) => !v)}
          />
          <main className="conteudo" id="conteudo">
            <Outlet />
          </main>
        </div>
      </div>

      <div className={`sidebar-overlay ${sidebarAberta ? 'show' : ''}`} onClick={() => setSidebarAberta(false)} />

      <NotifPanel aberto={sinoAberto} onFechar={() => setSinoAberto(false)} />

      <AssistenteColodelBot />
    </>
  );
}

function NotifPanel({ aberto, onFechar }) {
  const { notificacoes, marcarLida } = useNotificacoes();
  const { marcarTodas } = useNotificacoes();
  const { setSetorAtivo } = useApp();
  const { abrirDetalhe } = useTarefaModal();
  const nav = useNavigate();

  const cor = { urgente: 'var(--st-atrasada)', nova_demanda: 'var(--st-andamento)', tarefa_concluida: 'var(--st-concluida)' };

  const aoClicar = async (n) => {
    await marcarLida(n.id);
    onFechar();
    if (n.tarefa_id) {
      try {
        const t = (await API.get(`/api/tarefas/${n.tarefa_id}`)).tarefa;
        if (t) { setSetorAtivo(t.setor_id); nav('/kanban'); setTimeout(() => abrirDetalhe(t.id), 60); }
      } catch (_) { /* ignora */ }
    }
  };

  return (
    <div className={`notif-painel ${aberto ? 'show' : ''}`}>
      <div className="notif-topo">
        <h4>Notificações</h4>
        <button onClick={marcarTodas}>Marcar todas como lidas</button>
      </div>
      <div id="notif-lista">
        {!notificacoes.length ? (
          <div className="notif-vazio">Nenhuma notificação por aqui.</div>
        ) : notificacoes.map((n) => (
          <div key={n.id} className={`notif-item ${n.lida ? '' : 'nova'}`} onClick={() => aoClicar(n)}>
            <span className={`pino ${n.lida ? 'lida' : ''}`} style={!n.lida && cor[n.tipo] ? { background: cor[n.tipo] } : undefined} />
            <div>
              <b>{n.titulo}</b><br />
              <span>{n.mensagem}</span><br />
              <span>{formatarQuando(n.criado_em)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}