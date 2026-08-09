import { useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useTarefaModal } from '../context/TarefaModalContext';
import { RE_AFAZER } from '../lib/constants';
import { aplicarFiltros } from '../lib/filtros';
import { formatarData, formatarDuracao } from '../lib/format';
import Filtros from '../components/Filtros';
import BannerUrgentes from '../components/BannerUrgentes';

function classifica(t) {
  if (t.coluna_conclusao) return 'ok';
  if (t.atrasada) return 'alerta';
  if (RE_AFAZER.test(t.coluna_nome || '')) return 'afazer';
  return 'andamento';
}
const soData = (d) => (d ? new Date(d.slice(0, 10) + 'T00:00:00') : null);

function contar(tarefas) {
  const m = { total: tarefas.length, afazer: 0, andamento: 0, ok: 0, alerta: 0, urgente: 0, semResp: 0, vence7: 0, tempoSoma: 0, tempoN: 0 };
  const hoje = soData(new Date().toISOString());
  const em7 = new Date(hoje); em7.setDate(hoje.getDate() + 7);
  let proxima = null;
  tarefas.forEach((t) => {
    const st = classifica(t); m[st]++;
    if (t.prioridade === 'urgente' && st !== 'ok') m.urgente++;
    if (!(t.responsaveis && t.responsaveis.length)) m.semResp++;
    if (t.tempo_ms && t.tempo_ms > 0) { m.tempoSoma += t.tempo_ms; m.tempoN++; }
    const d = soData(t.data_entrega || t.data_publicacao);
    if (d && st !== 'ok') {
      if (d >= hoje && d <= em7) m.vence7++;
      if (!proxima || d < proxima.data) proxima = { data: d, titulo: t.titulo, iso: (t.data_entrega || t.data_publicacao) };
    }
  });
  m.taxa = m.total ? Math.round((m.ok / m.total) * 100) : 0;
  m.tempoMedio = m.tempoN ? Math.round(m.tempoSoma / m.tempoN) : 0;
  m.proxima = proxima;
  return m;
}

export default function VisaoGeral() {
  const { setores, setorAtivo, setSetorAtivo, filtros, refreshToken } = useApp();
  const { ehAdmin, ehCriativo } = useAuth();
  const { abrirDetalhe } = useTarefaModal();

  const [brutas, setBrutas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [arquivadas, setArquivadas] = useState(false);

  const filtro = ehAdmin ? (setorAtivo ?? 'todos') : setorAtivo;

  const carregar = useCallback(async () => {
    if (setorAtivo == null) return;
    setCarregando(true); setErro('');
    const q = (arquivadas && ehAdmin)
      ? (filtro === 'todos' ? '?arquivadas=1' : `?setor=${filtro}&arquivadas=1`)
      : (filtro === 'todos' ? '' : `?setor=${filtro}`);
    try { setBrutas((await API.get('/api/tarefas' + q)).tarefas); }
    catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }, [setorAtivo, filtro, arquivadas, ehAdmin, refreshToken]);

  useEffect(() => { carregar(); }, [carregar]);

  const criativo = setores.find((s) => s.slug === 'criativo' || s.nome === 'Criativo');
  const escopoTemCriativo = criativo && (filtro === 'todos' || Number(filtro) === criativo.id);
  const setorInfo = (id) => setores.find((s) => s.id === id) || { nome: 'Setor', cor: 'var(--brand)' };

  function retrabalho(tarefas) {
    const doCriativo = criativo ? tarefas.filter((t) => t.setor_id === criativo.id) : [];
    const n = doCriativo.length;
    const cont = (campo) => doCriativo.filter((t) => (t[campo] || 0) > 0).length;
    return {
      n,
      design: n ? Math.round((cont('retrabalho_design') / n) * 100) : 0,
      edicao: n ? Math.round((cont('retrabalho_edicao') / n) * 100) : 0,
      pdf: n ? Math.round((cont('retrabalho_pdf') / n) * 100) : 0,
    };
  }

  if (carregando) return <div className="carregando"><div className="spinner" />Carregando...</div>;
  if (erro) return <div className="vazio"><b>Não foi possível carregar</b>{erro}</div>;

  const tarefas = aplicarFiltros(brutas, filtros);
  const m = contar(tarefas);
  const clientesAtendidos = new Set(tarefas.filter((t) => t.cliente_id).map((t) => t.cliente_id)).size;
  const rt = (ehAdmin || ehCriativo) && escopoTemCriativo ? retrabalho(tarefas) : { n: 0 };

  const escolher = (val) => setSetorAtivo(val);

  const atrasadas = tarefas.filter((t) => classifica(t) === 'alerta')
    .sort((a, b) => (a.data_entrega || '').localeCompare(b.data_entrega || ''));

  // quebra por setor (modo "Todos")
  let grupos = null;
  if (filtro === 'todos') {
    grupos = {};
    tarefas.forEach((t) => { (grupos[t.setor_id] = grupos[t.setor_id] || []).push(t); });
  }

  return (
    <>
      {!ehAdmin && <BannerUrgentes tarefas={brutas} />}

      {ehAdmin && (
        <div className="vg-filtro">
          <button className={`chip-f ${String(filtro) === 'todos' ? 'on' : ''}`} onClick={() => escolher('todos')}>Todos</button>
          {setores.map((s) => (
            <button key={s.id} className={`chip-f ${String(filtro) === String(s.id) ? 'on' : ''}`} onClick={() => escolher(s.id)}>
              <span className="pt" style={{ background: s.cor }} />{s.nome}
            </button>
          ))}
          <button className={`chip-f arq ${arquivadas ? 'on' : ''}`} onClick={() => setArquivadas((v) => !v)} title="Mostrar tarefas concluídas há mais de 7 dias">
            Arquivadas
          </button>
        </div>
      )}

      <Filtros tarefas={brutas} />

      <div className="resumo">
        <div className="metrica destaque"><div className="n">{m.total}</div><div className="l">Total</div></div>
        <div className="metrica"><div className="n">{m.afazer}</div><div className="l">A fazer</div></div>
        <div className="metrica andamento"><div className="n">{m.andamento}</div><div className="l">Em andamento</div></div>
        <div className="metrica ok"><div className="n">{m.ok}</div><div className="l">Concluídas</div></div>
        <div className={`metrica ${m.alerta ? 'alerta' : ''}`}><div className="n">{m.alerta}</div><div className="l">Atrasadas</div></div>
      </div>

      <div className="resumo resumo-2">
        <div className={`metrica ${m.urgente ? 'alerta' : ''}`}><div className="n">{m.urgente}</div><div className="l">Urgentes</div></div>
        <div className="metrica"><div className="n">{m.vence7}</div><div className="l">Vencem em 7 dias</div></div>
        <div className="metrica"><div className="n">{m.semResp}</div><div className="l">Sem responsável</div></div>
        <div className="metrica"><div className="n" style={{ fontSize: 22 }}>{formatarDuracao(m.tempoMedio)}</div><div className="l">Tempo médio</div></div>
        <div className="metrica ok"><div className="n">{m.taxa}%</div><div className="l">Taxa de conclusão</div></div>
      </div>

      {rt.n > 0 && (
        <>
          <div className="vg-titulo">Retrabalho do Criativo <span className="vg-sub">({rt.n} tarefa{rt.n > 1 ? 's' : ''})</span></div>
          <div className="resumo resumo-3">
            <div className="metrica retrab"><div className="n">{rt.design}%</div><div className="l">Retrabalho Design</div></div>
            <div className="metrica retrab"><div className="n">{rt.edicao}%</div><div className="l">Retrabalho Edição</div></div>
            <div className="metrica retrab"><div className="n">{rt.pdf}%</div><div className="l">Retrabalho PDF</div></div>
          </div>
        </>
      )}

      <div className="vg-barra vg-barra-grande" title="Distribuição das tarefas">
        {m.afazer ? <span className="b-afazer" style={{ flex: m.afazer }} /> : null}
        {m.andamento ? <span className="b-andamento" style={{ flex: m.andamento }} /> : null}
        {m.ok ? <span className="b-ok" style={{ flex: m.ok }} /> : null}
        {m.alerta ? <span className="b-alerta" style={{ flex: m.alerta }} /> : null}
      </div>
      <div className="vg-legenda">
        <span><i className="lg" style={{ background: 'var(--st-afazer)' }} />A fazer</span>
        <span><i className="lg" style={{ background: 'var(--st-andamento)' }} />Em andamento</span>
        <span><i className="lg" style={{ background: 'var(--st-concluida)' }} />Concluídas</span>
        <span><i className="lg" style={{ background: 'var(--st-atrasada)' }} />Atrasadas</span>
      </div>

      {grupos && (
        <>
          <div className="vg-titulo">Por setor</div>
          <div className="vg-setores">
            {setores.filter((s) => grupos[s.id]).length
              ? setores.filter((s) => grupos[s.id]).map((s) => (
                <CardSetor key={s.id} s={s} m={contar(grupos[s.id])} onEscolher={() => escolher(s.id)} />
              ))
              : <div className="vazio" style={{ gridColumn: '1/-1' }}>Nenhuma tarefa cadastrada ainda.</div>}
          </div>
        </>
      )}

      {atrasadas.length > 0 && (
        <>
          <div className="vg-titulo">Atrasadas ({atrasadas.length})</div>
          <div className="vg-setores">
            {atrasadas.slice(0, 12).map((t) => {
              const s = setorInfo(t.setor_id);
              return (
                <div key={t.id} className="vg-setor-card clicavel" style={{ borderLeftColor: s.cor }} onClick={() => abrirDetalhe(t.id)}>
                  <h4>{t.titulo}</h4>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{s.nome}{t.cliente_nome ? ' · ' + t.cliente_nome : ''}</div>
                  <div style={{ fontSize: 12, color: 'var(--st-atrasada)', fontWeight: 600, marginTop: 6 }}>Entrega: {t.data_entrega ? formatarData(t.data_entrega) : '—'}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function CardSetor({ s, m, onEscolher }) {
  const seg = (cls, v) => (v ? <span className={cls} style={{ flex: v }} /> : null);
  const prox = m.proxima
    ? <>Próxima entrega: <b>{formatarData(m.proxima.iso)}</b> · {m.proxima.titulo}</>
    : 'Sem entregas pendentes';
  return (
    <div className="vg-setor-card clicavel" style={{ borderLeftColor: s.cor }} onClick={onEscolher}>
      <div className="vg-setor-head">
        <h4><span className="pt" style={{ background: s.cor }} />{s.nome}</h4>
        <span className="vg-taxa">{m.taxa}%</span>
      </div>
      <div className="vg-linha-metricas">
        <div className="vg-mini"><span className="n">{m.total}</span><span className="l">Total</span></div>
        <div className="vg-mini afazer"><span className="n">{m.afazer}</span><span className="l">A fazer</span></div>
        <div className="vg-mini andamento"><span className="n">{m.andamento}</span><span className="l">Andam.</span></div>
        <div className="vg-mini ok"><span className="n">{m.ok}</span><span className="l">Concl.</span></div>
        <div className="vg-mini alerta"><span className="n">{m.alerta}</span><span className="l">Atras.</span></div>
        <div className="vg-mini"><span className="n" style={{ fontSize: 15 }}>{formatarDuracao(m.tempoMedio)}</span><span className="l">Tempo méd.</span></div>
      </div>
      <div className="vg-barra">
        {seg('b-afazer', m.afazer)}{seg('b-andamento', m.andamento)}{seg('b-ok', m.ok)}{seg('b-alerta', m.alerta)}
      </div>
      <div className="vg-prox">{prox}</div>
    </div>
  );
}
