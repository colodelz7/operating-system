import { useState, useEffect, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin,
} from '@dnd-kit/core';
import { API } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTarefaModal } from '../context/TarefaModalContext';
import { MESES, DOW } from '../lib/constants';
import { aplicarFiltros } from '../lib/filtros';
import SeletorSetor from '../components/SeletorSetor';
import BannerUrgentes from '../components/BannerUrgentes';
import Filtros from '../components/Filtros';

// O calendário trabalha SEMPRE com a data de entrega, que é a data
// mostrada e editada dentro da demanda. (data_publicacao foi descontinuada.)
function campoData() {
  return 'data_entrega';
}
function dataDaTarefa(t) {
  return (t.data_entrega || t.data_publicacao || '').slice(0, 10);
}

// Data local em 'YYYY-MM-DD' (toISOString usa UTC e vira o dia à noite)
function isoLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function classeChip(t) {
  // conclusao pela flag do banco (nome enganava: "Programar" nao e concluida)
  return t.coluna_conclusao ? 'concluida' : (t.atrasada ? 'atrasada' : '');
}

function ChipTarefa({ t, onAbrir }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `t-${t.id}`, data: { tid: t.id },
  });
  // O movimento visual fica por conta do <DragOverlay> (fora do grid, sem
  // clipping). O chip original só esmaece enquanto arrasta.
  return (
    <div
      ref={setNodeRef} {...attributes} {...listeners}
      className={`cal-tarefa ${classeChip(t)} ${isDragging ? 'dragging' : ''}`}
      title={`${t.titulo} · arraste para remarcar`}
      onClick={() => { if (!isDragging) onAbrir(t.id); }}
    >
      {t.cliente_nome ? t.cliente_nome + ' · ' : ''}{t.titulo}
    </div>
  );
}

function DiaCelula({ iso, fora, hoje, numero, tarefas, onAbrir }) {
  const { setNodeRef, isOver } = useDroppable({ id: `d-${iso}`, data: { iso } });
  return (
    <div ref={setNodeRef} className={`cal-dia ${fora ? 'fora' : ''} ${hoje ? 'hoje' : ''} ${isOver ? 'dropivel' : ''}`}>
      <span className="num">{numero}</span>
      <div className="cal-tarefas">
        {tarefas.map((t) => <ChipTarefa key={t.id} t={t} onAbrir={onAbrir} />)}
      </div>
    </div>
  );
}

export default function Calendario() {
  const { setorAtivo, filtros, refreshToken } = useApp();
  const toast = useToast();
  const { abrirDetalhe } = useTarefaModal();

  const [tarefas, setTarefas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [ref, setRef] = useState(new Date());
  const [arrastando, setArrastando] = useState(null); // tarefa em drag (para o overlay)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const carregar = useCallback(async () => {
    if (setorAtivo == null) return;
    setCarregando(true); setErro('');
    const url = setorAtivo === 'todos' ? '/api/tarefas' : `/api/tarefas?setor=${setorAtivo}`;
    try { setTarefas((await API.get(url)).tarefas); }
    catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }, [setorAtivo, refreshToken]);

  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = aplicarFiltros(tarefas, filtros);

  function aoIniciar(ev) {
    const tid = ev.active?.data?.current?.tid;
    setArrastando(tarefas.find((x) => x.id === tid) || null);
  }

  async function aoSoltar(ev) {
    setArrastando(null);
    const iso = ev.over?.data?.current?.iso;
    const tid = ev.active?.data?.current?.tid;
    if (!iso || tid == null) return;
    const t = tarefas.find((x) => x.id === tid);
    if (!t) return;
    const campo = campoData(t);
    if ((t[campo] || '').slice(0, 10) === iso) return;

    const anterior = t[campo];
    setTarefas((arr) => arr.map((x) => (x.id === tid ? { ...x, [campo]: iso } : x)));
    try {
      const r = await API.put(`/api/tarefas/${tid}`, { [campo]: iso });
      setTarefas((arr) => arr.map((x) => (x.id === tid ? { ...x, ...r.tarefa } : x)));
      toast('Tarefa remarcada ✓', 'ok');
    } catch (err) {
      setTarefas((arr) => arr.map((x) => (x.id === tid ? { ...x, [campo]: anterior } : x)));
      toast(err.message, 'erro');
    }
  }

  if (carregando) return <div className="carregando"><div className="spinner" />Carregando...</div>;
  if (erro) return <div className="vazio"><b>Erro ao carregar</b>{erro}</div>;

  const ano = ref.getFullYear();
  const mes = ref.getMonth();
  const primeiro = new Date(ano, mes, 1);
  const inicioGrade = new Date(primeiro);
  inicioGrade.setDate(1 - primeiro.getDay());
  const hojeStr = isoLocal(new Date());

  const porData = {};
  visiveis.forEach((t) => {
    const data = dataDaTarefa(t);
    if (!data) return;
    (porData[data] = porData[data] || []).push(t);
  });

  const celulas = [];
  const cursor = new Date(inicioGrade);
  for (let i = 0; i < 42; i++) {
    const iso = isoLocal(cursor);
    celulas.push({ iso, fora: cursor.getMonth() !== mes, hoje: iso === hojeStr, numero: cursor.getDate(), tarefas: porData[iso] || [] });
    cursor.setDate(cursor.getDate() + 1);
  }

  return (
    <>
      <SeletorSetor />
      <BannerUrgentes tarefas={tarefas} />
      <Filtros tarefas={tarefas} />
      <div className="cal-topo">
        <span className="mes">{MESES[mes]} {ano}</span>
        <div className="cal-nav">
          <button onClick={() => setRef(new Date(ano, mes - 1, 1))} title="Mês anterior">‹</button>
          <button onClick={() => setRef(new Date())} title="Hoje">Hoje</button>
          <button onClick={() => setRef(new Date(ano, mes + 1, 1))} title="Próximo mês">›</button>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={pointerWithin}
        onDragStart={aoIniciar} onDragEnd={aoSoltar} onDragCancel={() => setArrastando(null)}>
        <div className="calendario">
          {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {celulas.map((c) => (
            <DiaCelula key={c.iso} {...c} onAbrir={abrirDetalhe} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {arrastando ? (
            <div className={`cal-tarefa overlay ${classeChip(arrastando)}`}>
              {arrastando.cliente_nome ? arrastando.cliente_nome + ' · ' : ''}{arrastando.titulo}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
