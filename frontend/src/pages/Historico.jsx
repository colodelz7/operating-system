import { useState, useEffect, useCallback, useRef } from 'react';
import { API } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useTarefaModal } from '../context/TarefaModalContext';
import { formatarQuando } from '../lib/format';

/* Trilha de auditoria. Tudo que aparece aqui foi gravado pelo backend:
   o navegador nao escreve historico e nao escolhe o autor do evento.

   Os filtros e a paginacao rodam no servidor. A tela carrega uma pagina por
   vez ("carregar mais"), entao a trilha pode crescer sem transformar esta
   pagina num carregamento de milhares de registros. */

const POR_PAGINA = 60;

const META = {
  criada: { ico: '＋', cor: 'var(--st-andamento)', rot: 'Criada' },
  editada: { ico: '✎', cor: 'var(--muted)', rot: 'Editada' },
  movida: { ico: '→', cor: 'var(--st-afazer)', rot: 'Movida' },
  concluida: { ico: '✓', cor: 'var(--st-concluida)', rot: 'Concluída' },
  excluida: { ico: '✕', cor: 'var(--st-atrasada)', rot: 'Excluída' },
  login: { ico: '⇲', cor: 'var(--st-concluida)', rot: 'Acesso (login)' },
  logout: { ico: '⇱', cor: 'var(--muted)', rot: 'Saída (logout)' },
  login_falha: { ico: '!', cor: 'var(--st-atrasada)', rot: 'Senha errada' },
  login_bloqueio: { ico: '⊘', cor: 'var(--st-atrasada)', rot: 'Bloqueio' },
};

// "Tipo" = o que foi afetado. Vem do backend no campo entidade.
const ENTIDADES = {
  tarefa: 'Tarefas',
  cliente: 'Clientes',
  usuario: 'Usuários',
  setor: 'Setores',
  sessao: 'Acessos',
};

const F_VAZIO = { entidade: '', usuario: '', setor: '', tipo: '', de: '', ate: '', q: '' };

// data completa para o painel de detalhes (dd/mm/aaaa hh:mm:ss)
function dataCompleta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pt-BR');
}

// resume o user agent num nome de navegador legivel, mantendo o texto cru
// disponivel logo abaixo (auditoria de verdade precisa do original).
function navegadorCurto(ua) {
  const s = String(ua || '');
  if (!s) return 'não informado';
  if (/edg\//i.test(s)) return 'Edge';
  if (/opr\//i.test(s)) return 'Opera';
  if (/chrome\//i.test(s) && !/chromium/i.test(s)) return 'Chrome';
  if (/firefox\//i.test(s)) return 'Firefox';
  if (/safari\//i.test(s)) return 'Safari';
  if (/node|undici|curl/i.test(s)) return 'Automação/CLI';
  return 'Outro';
}

function montarBusca(f, extras = {}) {
  const p = new URLSearchParams();
  if (f.entidade) p.set('entidade', f.entidade);
  if (f.tipo) p.set('tipo', f.tipo);
  if (f.setor) p.set('setor', f.setor);
  if (f.de) p.set('de', f.de);
  if (f.ate) p.set('ate', f.ate);
  if (f.q) p.set('q', f.q);
  Object.entries(extras).forEach(([k, v]) => { if (v != null) p.set(k, String(v)); });
  p.set('limit', String(POR_PAGINA));
  return p.toString();
}

export default function Historico() {
  const { setores } = useApp();
  const { abrirDetalhe } = useTarefaModal();

  const [itens, setItens] = useState([]);
  const [opcoes, setOpcoes] = useState(null);
  const [temMais, setTemMais] = useState(false);
  const [proximo, setProximo] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState('');
  const [f, setF] = useState(F_VAZIO);
  const [busca, setBusca] = useState('');       // o que esta digitado
  const [selecionado, setSelecionado] = useState(null);

  // o texto so vira filtro depois que a pessoa para de digitar
  useEffect(() => {
    const id = setTimeout(() => setF((x) => (x.q === busca ? x : { ...x, q: busca })), 400);
    return () => clearTimeout(id);
  }, [busca]);

  // opcoes dos seletores: vem do banco inteiro, nao so da pagina carregada
  useEffect(() => {
    let vivo = true;
    API.get('/api/historico/opcoes')
      .then((r) => { if (vivo) setOpcoes(r); })
      .catch(() => { /* seletores ficam vazios, a lista continua funcionando */ });
    return () => { vivo = false; };
  }, []);

  // primeira pagina (recarrega a cada mudanca de filtro)
  useEffect(() => {
    let vivo = true;
    setCarregando(true); setErro('');
    API.get(`/api/historico?${montarBusca(f)}`)
      .then((r) => {
        if (!vivo) return;
        setItens(r.historico);
        setTemMais(!!r.tem_mais);
        setProximo(r.proximo);
      })
      .catch((e) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [f]);

  const carregarMais = useCallback(async () => {
    if (!temMais || carregandoMais || proximo == null) return;
    setCarregandoMais(true);
    try {
      const r = await API.get(`/api/historico?${montarBusca(f, { antes_de: proximo })}`);
      setItens((lista) => [...lista, ...r.historico]);
      setTemMais(!!r.tem_mais);
      setProximo(r.proximo);
    } catch (e) { setErro(e.message); }
    finally { setCarregandoMais(false); }
  }, [f, proximo, temMais, carregandoMais]);

  const setorNome = (id) => { const s = setores.find((x) => x.id === Number(id)); return s ? s.nome : ('Setor ' + id); };
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const limparFiltros = () => { setBusca(''); setF(F_VAZIO); };

  const temFiltro = JSON.stringify(f) !== JSON.stringify(F_VAZIO);

  return (
    <>
      <div className="barra-filtros hist-filtros">
        <span className="bf-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
          Filtros
        </span>
        <input className="bf-sel" type="search" placeholder="Buscar (tarefa, pessoa, detalhe, IP)..."
          value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className="bf-sel" value={f.entidade} onChange={(e) => set('entidade', e.target.value)}>
          <option value="">Tipo: todos</option>
          {(opcoes?.entidades || []).map((k) => <option key={k} value={k}>{ENTIDADES[k] || k}</option>)}
        </select>
        <select className="bf-sel" value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>
          <option value="">Ação: todas</option>
          {(opcoes?.tipos || []).map((k) => <option key={k} value={k}>{(META[k] || {}).rot || k}</option>)}
        </select>
        <select className="bf-sel" value={f.setor} onChange={(e) => set('setor', e.target.value)}>
          <option value="">Setor: todos</option>
          {(opcoes?.setores || []).map((id) => <option key={id} value={id}>{setorNome(id)}</option>)}
        </select>
        <label className="bf-data-wrap">De <input type="date" className="bf-data" value={f.de} onChange={(e) => set('de', e.target.value)} /></label>
        <label className="bf-data-wrap">Até <input type="date" className="bf-data" value={f.ate} onChange={(e) => set('ate', e.target.value)} /></label>
        <button className="bf-limpar" onClick={limparFiltros}>Limpar</button>
      </div>

      <div className="hist-contador">
        {carregando ? 'Carregando...' : (
          <>
            {itens.length} registro{itens.length === 1 ? '' : 's'}
            {temMais ? ' (há mais)' : ''}
            {opcoes?.total != null && !temFiltro ? ` de ${opcoes.total} no total` : ''}
          </>
        )}
      </div>

      {erro && <div className="vazio"><b>Não foi possível carregar</b>{erro}</div>}

      {carregando ? (
        <div className="carregando"><div className="spinner" />Carregando...</div>
      ) : (
        <div className="hist-timeline">
          {itens.length ? itens.map((h, idx) => {
            const m = META[h.tipo] || { ico: '•', cor: 'var(--muted)', rot: h.tipo };
            const resp = (h.responsaveis || []).map((r) => r.nome).join(', ');
            const ativo = selecionado && selecionado.id === h.id;
            return (
              <div
                key={h.id || idx}
                className={`hist-item clicavel ${ativo ? 'ativo' : ''}`}
                onClick={() => setSelecionado(h)}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelecionado(h); } }}
              >
                <span className="hist-ico" style={{ background: m.cor }}>{m.ico}</span>
                <div className="hist-corpo">
                  <div className="hist-linha1"><b>{h.usuario_nome || 'Alguém'}</b> {h.detalhe || m.rot.toLowerCase()}</div>
                  <div className="hist-linha2">
                    <span className="hist-tarefa">{h.titulo || ''}</span>
                    <span className="hist-tag">{ENTIDADES[h.entidade || 'tarefa'] || h.entidade}</span>
                    {h.cliente_nome && <span className="hist-cli">{h.cliente_nome}</span>}
                    {resp && <span className="hist-resp">👤 {resp}</span>}
                    {h.setor_id && <span className="hist-setor">{setorNome(h.setor_id)}</span>}
                    {h.ip && <span className="hist-ip">IP {h.ip}</span>}
                    <span className="hist-quando">{formatarQuando(h.criado_em)}</span>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="vazio" style={{ marginTop: 8 }}>
              <b>{temFiltro ? 'Nada encontrado' : 'Sem histórico ainda'}</b>
              {temFiltro
                ? 'Ajuste os filtros para ver mais.'
                : 'Acessos e alterações de tarefas, clientes, setores e usuários vão aparecer aqui.'}
            </div>
          )}

          {temMais && (
            <button className="btn btn-ghost hist-mais" onClick={carregarMais} disabled={carregandoMais}>
              {carregandoMais ? 'Carregando...' : 'Carregar mais'}
            </button>
          )}
        </div>
      )}

      <PainelDetalhe
        evento={selecionado}
        setorNome={setorNome}
        onFechar={() => setSelecionado(null)}
        onAbrirTarefa={(id) => { setSelecionado(null); abrirDetalhe(id); }}
      />
    </>
  );
}

function Linha({ rot, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="hd-linha">
      <span className="hd-rot">{rot}</span>
      <span className="hd-val">{children}</span>
    </div>
  );
}

function PainelDetalhe({ evento, setorNome, onFechar, onAbrirTarefa }) {
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;

  useEffect(() => {
    if (!evento) return undefined;
    const esc = (e) => { if (e.key === 'Escape') fecharRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [evento]);

  if (!evento) return null;
  const m = META[evento.tipo] || { rot: evento.tipo, cor: 'var(--muted)', ico: '•' };
  const resp = (evento.responsaveis || []).map((r) => r.nome).join(', ');
  const podeAbrir = evento.tarefa_id && evento.tipo !== 'excluida';

  return (
    <>
      <div className="hd-overlay" onClick={onFechar} />
      <aside className="hist-detalhe" role="dialog" aria-label="Detalhes do evento">
        <div className="hd-topo">
          <span className="hist-ico" style={{ background: m.cor }}>{m.ico}</span>
          <div>
            <b>{m.rot}</b>
            <div className="hd-sub">{ENTIDADES[evento.entidade || 'tarefa'] || evento.entidade}</div>
          </div>
          <button className="hd-fechar" onClick={onFechar} aria-label="Fechar detalhes">✕</button>
        </div>

        <div className="hd-corpo">
          <Linha rot="O que houve">{evento.detalhe || m.rot}</Linha>
          <Linha rot="Registro">{evento.titulo}</Linha>
          <Linha rot="Quem">{evento.usuario_nome || 'não identificado'}</Linha>
          <Linha rot="Quando">{dataCompleta(evento.criado_em)}</Linha>
          <Linha rot="IP">{evento.ip || 'não registrado'}</Linha>
          <Linha rot="Navegador">
            {navegadorCurto(evento.user_agent)}
            {evento.user_agent ? <div className="hd-ua">{evento.user_agent}</div> : null}
          </Linha>
          <Linha rot="Setor">{evento.setor_id ? setorNome(evento.setor_id) : ''}</Linha>
          <Linha rot="Cliente">{evento.cliente_nome}</Linha>
          <Linha rot="Responsáveis">{resp}</Linha>
          <Linha rot="Identificador">{`#${evento.id}`}</Linha>
        </div>

        {podeAbrir && (
          <div className="hd-rodape">
            <button className="btn btn-primary btn-sm" onClick={() => onAbrirTarefa(evento.tarefa_id)}>
              Abrir a tarefa
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
