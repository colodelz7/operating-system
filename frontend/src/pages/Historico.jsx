import { useState, useEffect, useMemo } from 'react';
import { API } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useTarefaModal } from '../context/TarefaModalContext';
import { formatarQuando } from '../lib/format';

const META = {
  criada: { ico: '＋', cor: 'var(--st-andamento)', rot: 'Criada' },
  editada: { ico: '✎', cor: 'var(--muted)', rot: 'Editada' },
  movida: { ico: '→', cor: 'var(--st-afazer)', rot: 'Movida' },
  concluida: { ico: '✓', cor: 'var(--st-concluida)', rot: 'Concluída' },
  excluida: { ico: '✕', cor: 'var(--st-atrasada)', rot: 'Excluída' },
  login: { ico: '⇲', cor: 'var(--st-concluida)', rot: 'Acesso (login)' },
  login_falha: { ico: '!', cor: 'var(--st-atrasada)', rot: 'Login falhou' },
  login_bloqueio: { ico: '⊘', cor: 'var(--st-atrasada)', rot: 'Bloqueio' },
};
// categorias rapidas (agrupam varios tipos de uma vez)
const CATS = {
  tarefas: ['criada', 'editada', 'movida', 'concluida', 'excluida'],
  acessos: ['login', 'login_falha', 'login_bloqueio'],
  falhas: ['login_falha'],
  bloqueios: ['login_bloqueio'],
};
const F_VAZIO = { cat: '', usuario: '', setor: '', cliente: '', responsavel: '', tipo: '', prioridade: '', de: '', ate: '', q: '' };

export default function Historico() {
  const { setores } = useApp();
  const { abrirDetalhe } = useTarefaModal();
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [f, setF] = useState(F_VAZIO);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try { const r = await API.get('/api/tarefas/historico'); if (vivo) setItens(r.historico); }
      catch (e) { if (vivo) setErro(e.message); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, []);

  const setorNome = (id) => { const s = setores.find((x) => x.id === Number(id)); return s ? s.nome : ('Setor ' + id); };
  const setDistintos = (arr) => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));

  const opcoes = useMemo(() => ({
    usuarios: setDistintos(itens.map((h) => h.usuario_nome)),
    clientes: setDistintos(itens.map((h) => h.cliente_nome)),
    setoresIds: setDistintos(itens.map((h) => h.setor_id)),
    respNomes: setDistintos(itens.flatMap((h) => (h.responsaveis || []).map((r) => r.nome))),
  }), [itens]);

  const passa = (h) => {
    if (f.cat && !CATS[f.cat].includes(h.tipo)) return false;
    if (f.usuario && h.usuario_nome !== f.usuario) return false;
    if (f.setor && String(h.setor_id) !== String(f.setor)) return false;
    if (f.cliente && h.cliente_nome !== f.cliente) return false;
    if (f.responsavel && !(h.responsaveis || []).some((r) => r.nome === f.responsavel)) return false;
    if (f.tipo && h.tipo !== f.tipo) return false;
    if (f.prioridade && h.prioridade !== f.prioridade) return false;
    const dia = (h.criado_em || '').slice(0, 10);
    if (f.de && dia < f.de) return false;
    if (f.ate && dia > f.ate) return false;
    if (f.q) {
      const alvo = `${h.titulo || ''} ${h.cliente_nome || ''} ${h.usuario_nome || ''} ${h.ip || ''}`.toLowerCase();
      if (!alvo.includes(f.q.toLowerCase())) return false;
    }
    return true;
  };

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  if (carregando) return <div className="carregando"><div className="spinner" />Carregando...</div>;
  if (erro) return <div className="vazio"><b>Não foi possível carregar</b>{erro}</div>;
  if (!itens.length) {
    return <div className="vazio"><b>Sem histórico ainda</b>As ações nas tarefas (criação, edição, movimentação, conclusão e exclusão) vão aparecer aqui.</div>;
  }

  const filtrados = itens.filter(passa);

  return (
    <>
      <div className="barra-filtros hist-filtros">
        <span className="bf-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
          Filtros
        </span>
        <input className="bf-sel" type="search" placeholder="Buscar (tarefa, usuário, IP)..." value={f.q} onChange={(e) => set('q', e.target.value)} />
        <select className="bf-sel" value={f.cat} onChange={(e) => set('cat', e.target.value)}>
          <option value="">Registros: todos</option>
          <option value="tarefas">Só tarefas</option>
          <option value="acessos">Acessos e logins</option>
          <option value="falhas">Tentativas de login falhas</option>
          <option value="bloqueios">Bloqueios</option>
        </select>
        <select className="bf-sel" value={f.usuario} onChange={(e) => set('usuario', e.target.value)}>
          <option value="">Usuário: todos</option>
          {opcoes.usuarios.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select className="bf-sel" value={f.setor} onChange={(e) => set('setor', e.target.value)}>
          <option value="">Setor: todos</option>
          {opcoes.setoresIds.map((id) => <option key={id} value={id}>{setorNome(id)}</option>)}
        </select>
        <select className="bf-sel" value={f.cliente} onChange={(e) => set('cliente', e.target.value)}>
          <option value="">Cliente: todos</option>
          {opcoes.clientes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="bf-sel" value={f.responsavel} onChange={(e) => set('responsavel', e.target.value)}>
          <option value="">Responsável: todos</option>
          {opcoes.respNomes.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="bf-sel" value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>
          <option value="">Ação: todas</option>
          {Object.keys(META).map((k) => <option key={k} value={k}>{META[k].rot}</option>)}
        </select>
        <select className="bf-sel" value={f.prioridade} onChange={(e) => set('prioridade', e.target.value)}>
          <option value="">Urgência: todas</option>
          {['urgente', 'alta', 'normal', 'baixa'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </select>
        <label className="bf-data-wrap">De <input type="date" className="bf-data" value={f.de} onChange={(e) => set('de', e.target.value)} /></label>
        <label className="bf-data-wrap">Até <input type="date" className="bf-data" value={f.ate} onChange={(e) => set('ate', e.target.value)} /></label>
        <button className="bf-limpar" onClick={() => setF(F_VAZIO)}>Limpar</button>
      </div>

      <div className="hist-contador">{filtrados.length} de {itens.length} registro{itens.length > 1 ? 's' : ''}</div>

      <div className="hist-timeline">
        {filtrados.length ? filtrados.map((h, idx) => {
          const m = META[h.tipo] || { ico: '•', cor: 'var(--muted)', rot: h.tipo };
          const clic = h.tarefa_id && h.tipo !== 'excluida';
          const resp = (h.responsaveis || []).map((r) => r.nome).join(', ');
          return (
            <div key={h.id || idx} className={`hist-item ${clic ? 'clicavel' : ''}`} onClick={clic ? () => abrirDetalhe(h.tarefa_id) : undefined}>
              <span className="hist-ico" style={{ background: m.cor }}>{m.ico}</span>
              <div className="hist-corpo">
                <div className="hist-linha1"><b>{h.usuario_nome || 'Alguém'}</b> {h.detalhe || m.rot.toLowerCase()}</div>
                <div className="hist-linha2">
                  <span className="hist-tarefa">{h.titulo || ''}</span>
                  {h.cliente_nome && <span className="hist-cli">{h.cliente_nome}</span>}
                  {resp && <span className="hist-resp">👤 {resp}</span>}
                  {h.setor_id && <span className="hist-setor">{setorNome(h.setor_id)}</span>}
                  {h.ip && <span className="hist-ip">IP {h.ip}</span>}
                  <span className="hist-quando">{formatarQuando(h.criado_em)}</span>
                </div>
              </div>
            </div>
          );
        }) : <div className="vazio" style={{ marginTop: 8 }}><b>Nada encontrado</b>Ajuste os filtros para ver mais.</div>}
      </div>
    </>
  );
}
