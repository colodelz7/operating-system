import { useState, useEffect, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { API } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTarefaModal } from '../context/TarefaModalContext';
import { aplicarFiltros } from '../lib/filtros';
import { iniciais, formatarData } from '../lib/format';
import SeletorSetor from '../components/SeletorSetor';
import BannerUrgentes from '../components/BannerUrgentes';
import Filtros from '../components/Filtros';

const RE_AFAZER_COL = /pendente|a fazer|backlog|to.?do|fila/;
const RE_RETRAB_COL = /retrabalho|revis|ajuste|reprov|corre[çc]/;

// Conclusao = APENAS a flag e_conclusao do banco. Nada de adivinhar pelo
// nome: "Programar" casava com /program/ e travava indevidamente.
function ehColunaConclusao(col) {
  return !!(col && col.e_conclusao);
}
function statusColuna(col) {
  if (ehColunaConclusao(col)) return 'concluida';
  const n = (col?.nome || '').toLowerCase();
  if (RE_RETRAB_COL.test(n)) return 'retrabalho';
  if (RE_AFAZER_COL.test(n)) return 'afazer';
  return 'andamento';
}
function classificaGlobal(t) {
  if (t.coluna_conclusao) return 'concluida';
  if (t.atrasada) return 'atrasada';
  if (RE_AFAZER_COL.test((t.coluna_nome || '').toLowerCase())) return 'afazer';
  return 'andamento';
}

function Resps({ lista }) {
  return (lista || []).slice(0, 3).map((r) => (
    <span key={r.id} className="avatar" title={r.nome}>{iniciais(r.nome)}</span>
  ));
}

/* ---- Card arrastavel (modo por setor) ----
   Em coluna de conclusao a tarefa fica TRAVADA para membros
   (o backend tambem bloqueia; aqui so evita o arrasto inutil). */
function CardArrastavel({ t, col, onAbrir }) {
  const { ehAdmin } = useApp();
  const concluida = ehColunaConclusao(col);
  const travada = concluida && !ehAdmin;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `t-${t.id}`, data: { tid: t.id }, disabled: travada,
  });
  const mostraAtraso = t.atrasada && !concluida;
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <article
      ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`card p-${t.prioridade} ${isDragging ? 'dragging' : ''} ${travada ? 'travada' : ''}`}
      title={travada ? 'Concluída — travada (só admin reabre)' : undefined}
      onClick={() => { if (!isDragging) onAbrir(t.id); }}
    >
      <div className={`cli ${t.cliente_nome ? '' : 'sem'}`}>{t.cliente_nome || 'Sem cliente'}</div>
      <div className="titulo">{t.titulo}</div>
      <div className="rodape">
        {mostraAtraso ? <span className="tag-atraso">Atrasado</span>
          : (t.data_entrega ? <span className="datas">🗓 {formatarData(t.data_entrega)}</span> : null)}
        {t.anexos && t.anexos.length ? <span className="tag-anexo">📎 {t.anexos.length}</span> : null}
        <span className="resp"><Resps lista={t.responsaveis} /></span>
      </div>
    </article>
  );
}

/* ---- Coluna (drop zone) ---- */
function ColunaDrop({ col, tarefas, onAbrir }) {
  const { setNodeRef, isOver } = useDroppable({ id: `c-${col.id}`, data: { cid: col.id } });
  return (
    <section className={`coluna st-${statusColuna(col)}`}>
      <div className="coluna-topo">
        <span className="dot-et" />
        <span className="nome">{col.nome}</span>
        <span className="cont">{tarefas.length}</span>
      </div>
      <div ref={setNodeRef} className={`coluna-lista ${isOver ? 'dragover' : ''}`}>
        {tarefas.length ? tarefas.map((t) => (
          <CardArrastavel key={t.id} t={t} col={col} onAbrir={onAbrir} />
        )) : <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>Sem tarefas</div>}
      </div>
    </section>
  );
}

/* ---- Card do modo "Todos" (sem DnD) ---- */
function CardTodos({ t, onAbrir }) {
  const concl = !!t.coluna_conclusao;
  const mostraAtraso = t.atrasada && !concl;
  return (
    <article className={`card p-${t.prioridade}`} onClick={() => onAbrir(t.id)}>
      <div className={`cli ${t.cliente_nome ? '' : 'sem'}`}>{t.cliente_nome || 'Sem cliente'}</div>
      <div className="titulo">{t.titulo}</div>
      <div className="card-setor">{t.setor_nome || ''}{t.coluna_nome ? ' · ' + t.coluna_nome : ''}</div>
      <div className="rodape">
        {mostraAtraso ? <span className="tag-atraso">Atrasado</span>
          : (t.data_entrega ? <span className="datas">🗓 {formatarData(t.data_entrega)}</span> : null)}
        <span className="resp"><Resps lista={t.responsaveis} /></span>
      </div>
    </article>
  );
}

export default function Kanban() {
  const { setorAtivo, filtros, refreshToken } = useApp();
  const toast = useToast();
  const { abrirDetalhe } = useTarefaModal();

  const [colunas, setColunas] = useState([]);
  const [tarefas, setTarefas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [ativa, setAtiva] = useState(null); // tarefa em arrasto (overlay)

  const todos = setorAtivo === 'todos';
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const carregar = useCallback(async () => {
    if (setorAtivo == null) return;
    setCarregando(true); setErro('');
    try {
      if (todos) {
        setColunas([]);
        setTarefas((await API.get('/api/tarefas')).tarefas);
      } else {
        const [rc, rt] = await Promise.all([
          API.get(`/api/setores/${setorAtivo}/colunas`),
          API.get(`/api/tarefas?setor=${setorAtivo}`),
        ]);
        setColunas(rc.colunas);
        setTarefas(rt.tarefas);
      }
    } catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }, [setorAtivo, todos, refreshToken]);

  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = aplicarFiltros(tarefas, filtros);

  async function aoSoltar(ev) {
    setAtiva(null);
    const over = ev.over;
    const tid = ev.active?.data?.current?.tid;
    if (!over || tid == null) return;
    const novaCol = over.data?.current?.cid;
    const t = tarefas.find((x) => x.id === tid);
    if (!t || novaCol == null || t.coluna_id === novaCol) return;

    const anterior = t.coluna_id;
    setTarefas((arr) => arr.map((x) => (x.id === tid ? { ...x, coluna_id: novaCol } : x)));
    try {
      const r = await API.patch(`/api/tarefas/${tid}/mover`, { coluna_id: novaCol });
      setTarefas((arr) => arr.map((x) => (x.id === tid ? { ...x, ...r.tarefa } : x)));
      const col = colunas.find((c) => c.id === novaCol);
      if (col && col.e_conclusao) toast('Tarefa concluída ✓', 'ok');
    } catch (err) {
      setTarefas((arr) => arr.map((x) => (x.id === tid ? { ...x, coluna_id: anterior } : x)));
      toast(err.message, 'erro');
    }
  }

  if (carregando) return <div className="carregando"><div className="spinner" />Carregando...</div>;
  if (erro) return <div className="vazio"><b>Não foi possível carregar</b>{erro}</div>;

  /* ----- modo TODOS (agregado, sem DnD) ----- */
  if (todos) {
    const grupos = { afazer: [], andamento: [], atrasada: [], concluida: [] };
    visiveis.forEach((t) => grupos[classificaGlobal(t)].push(t));
    const defs = [
      { k: 'afazer', nome: 'A fazer', st: 'afazer' },
      { k: 'andamento', nome: 'Em andamento', st: 'andamento' },
      { k: 'atrasada', nome: 'Atrasadas', st: 'atrasada' },
      { k: 'concluida', nome: 'Concluídas', st: 'concluida' },
    ];
    return (
      <>
        <SeletorSetor />
        <BannerUrgentes tarefas={tarefas} />
        <Filtros tarefas={tarefas} />
        <div className="resumo">
          <div className="metrica destaque"><div className="n">{visiveis.length}</div><div className="l">Todas as tarefas</div></div>
          <div className="metrica"><div className="n">{grupos.afazer.length}</div><div className="l">A fazer</div></div>
          <div className="metrica andamento"><div className="n">{grupos.andamento.length}</div><div className="l">Em andamento</div></div>
          <div className="metrica ok"><div className="n">{grupos.concluida.length}</div><div className="l">Concluídas</div></div>
          <div className={`metrica ${grupos.atrasada.length ? 'alerta' : ''}`}><div className="n">{grupos.atrasada.length}</div><div className="l">Atrasadas</div></div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 12px' }}>
          Visão consolidada de todos os setores. Abra uma tarefa para ver os detalhes; para mover, escolha o setor específico.
        </p>
        <div className="kanban">
          {defs.map((d) => (
            <section key={d.k} className={`coluna st-${d.st}`}>
              <div className="coluna-topo"><span className="dot-et" /><span className="nome">{d.nome}</span><span className="cont">{grupos[d.k].length}</span></div>
              <div className="coluna-lista">
                {grupos[d.k].length ? grupos[d.k].map((t) => <CardTodos key={t.id} t={t} onAbrir={abrirDetalhe} />)
                  : <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>Sem tarefas</div>}
              </div>
            </section>
          ))}
        </div>
      </>
    );
  }

  /* ----- modo por SETOR (com DnD) ----- */
  const primeiraId = colunas.length ? colunas.slice().sort((a, b) => a.ordem - b.ordem)[0].id : null;
  let aFazer = 0, andamento = 0, concluidas = 0, atrasadas = 0;
  visiveis.forEach((t) => {
    const col = colunas.find((c) => c.id === t.coluna_id);
    if (ehColunaConclusao(col)) { concluidas++; return; }
    if (t.atrasada) { atrasadas++; return; }
    if (col && col.id === primeiraId) { aFazer++; return; }
    andamento++;
  });
  const ativaObj = ativa ? tarefas.find((x) => x.id === ativa) : null;

  return (
    <>
      <SeletorSetor />
      <BannerUrgentes tarefas={tarefas} />
      <Filtros tarefas={tarefas} />
      <div className="resumo">
        <div className="metrica destaque"><div className="n">{visiveis.length}</div><div className="l">No setor</div></div>
        <div className="metrica"><div className="n">{aFazer}</div><div className="l">A fazer</div></div>
        <div className="metrica andamento"><div className="n">{andamento}</div><div className="l">Em andamento</div></div>
        <div className="metrica ok"><div className="n">{concluidas}</div><div className="l">Concluídas</div></div>
        <div className={`metrica ${atrasadas ? 'alerta' : ''}`}><div className="n">{atrasadas}</div><div className="l">Atrasadas</div></div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(ev) => setAtiva(ev.active?.data?.current?.tid ?? null)}
        onDragCancel={() => setAtiva(null)}
        onDragEnd={aoSoltar}
      >
        <div className="kanban">
          {colunas.map((col) => (
            <ColunaDrop key={col.id} col={col} onAbrir={abrirDetalhe}
              tarefas={visiveis.filter((t) => t.coluna_id === col.id)} />
          ))}
        </div>
        <DragOverlay>
          {ativaObj ? (
            <article className={`card p-${ativaObj.prioridade} dragging`}>
              <div className={`cli ${ativaObj.cliente_nome ? '' : 'sem'}`}>{ativaObj.cliente_nome || 'Sem cliente'}</div>
              <div className="titulo">{ativaObj.titulo}</div>
            </article>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
