import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useAgenda } from '../context/AgendaContext';
import { MESES, DOW } from '../lib/constants';
import { isoLocal, formatarDataLonga } from '../lib/format';
import Avatar from '../components/Avatar';

/* Calendario da Equipe: agenda interna (reunioes, gravacoes, visitas,
   folgas). Os eventos ficam no proprio sistema; quem ve o que e decidido
   no servidor (equipe toda, o proprio setor ou quem foi chamado). */

const VAZIO = { titulo: '', data: '', hora_inicio: '', hora_fim: '', local: '', setor_id: '', descricao: '', participantes: [] };

function ModalEvento({ evento, dataInicial, onFechar, onSalvo }) {
  const { usuario, ehAdmin } = useAuth();
  const { setores } = useApp();
  const toast = useToast();
  const novo = !evento;
  const podeEditar = novo || ehAdmin || evento.criado_por === usuario?.id;

  const [f, setF] = useState(() => (novo ? { ...VAZIO, data: dataInicial || isoLocal() } : {
    titulo: evento.titulo, data: evento.data, hora_inicio: evento.hora_inicio || '', hora_fim: evento.hora_fim || '',
    local: evento.local || '', setor_id: evento.setor_id ? String(evento.setor_id) : '',
    descricao: evento.descricao || '', participantes: (evento.participantes || []).map((p) => p.id),
  }));
  const [equipe, setEquipe] = useState([]);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    API.get('/api/equipe').then((r) => setEquipe(r.equipe || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar]);

  const alternar = (id) => set('participantes', f.participantes.includes(id)
    ? f.participantes.filter((x) => x !== id) : [...f.participantes, id]);

  const filtrados = equipe.filter((p) => !busca || p.nome.toLowerCase().includes(busca.toLowerCase()));

  async function salvar() {
    if (!f.titulo.trim()) { toast('Dê um título ao evento', 'erro'); return; }
    if (!f.data) { toast('Escolha a data', 'erro'); return; }
    setSalvando(true);
    const corpo = { ...f, setor_id: f.setor_id ? Number(f.setor_id) : null };
    try {
      if (novo) await API.post('/api/eventos', corpo);
      else await API.put(`/api/eventos/${evento.id}`, corpo);
      toast(novo ? 'Evento marcado ✓' : 'Evento atualizado ✓', 'ok');
      onSalvo();
    } catch (e) { toast(e.message, 'erro'); }
    finally { setSalvando(false); }
  }

  async function excluir() {
    if (!window.confirm(`Excluir o evento "${evento.titulo}"?`)) return;
    try { await API.del(`/api/eventos/${evento.id}`); toast('Evento excluído', 'ok'); onSalvo(); }
    catch (e) { toast(e.message, 'erro'); }
  }

  // quem nao criou so consulta
  if (!podeEditar) {
    return (
      <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
        <div className="modal" role="dialog" aria-label="Evento">
          <div className="modal-topo"><h3>{evento.titulo}</h3><button className="fechar" onClick={onFechar} aria-label="Fechar">&times;</button></div>
          <div className="modal-corpo ev-ver">
            <p><b>{formatarDataLonga(evento.data)}</b>{evento.hora_inicio ? ` · ${evento.hora_inicio}${evento.hora_fim ? '–' + evento.hora_fim : ''}` : ' · dia todo'}</p>
            {evento.local && <p>📍 {evento.local}</p>}
            <p>{evento.setor_nome ? `Setor: ${evento.setor_nome}` : 'Equipe toda'} · marcado por {evento.criado_por_nome || 'alguém'}</p>
            {evento.descricao && <p className="ev-desc">{evento.descricao}</p>}
            {(evento.participantes || []).length > 0 && (
              <div className="ev-pessoas">
                {evento.participantes.map((p) => <span key={p.id} className="ev-pessoa"><Avatar pessoa={p} tamanho={22} />{p.nome}</span>)}
              </div>
            )}
          </div>
          <div className="modal-rodape"><button className="btn btn-ghost" onClick={onFechar}>Fechar</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal" role="dialog" aria-label={novo ? 'Novo evento' : 'Editar evento'}>
        <div className="modal-topo">
          <h3>{novo ? 'Novo evento' : 'Editar evento'}</h3>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">&times;</button>
        </div>
        <div className="modal-corpo">
          <div className="campo"><label>Título</label>
            <input value={f.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ex.: Reunião de pauta" autoFocus />
          </div>
          <div className="grid-3">
            <div className="campo"><label>Data</label><input type="date" value={f.data} onChange={(e) => set('data', e.target.value)} /></div>
            <div className="campo"><label>Início</label><input type="time" value={f.hora_inicio} onChange={(e) => set('hora_inicio', e.target.value)} /></div>
            <div className="campo"><label>Fim</label><input type="time" value={f.hora_fim} onChange={(e) => set('hora_fim', e.target.value)} /></div>
          </div>
          <div className="grid-2">
            <div className="campo"><label>Local ou link</label>
              <input value={f.local} onChange={(e) => set('local', e.target.value)} placeholder="Sala, endereço ou link da chamada" />
            </div>
            <div className="campo"><label>Quem vê</label>
              <select value={f.setor_id} onChange={(e) => set('setor_id', e.target.value)}>
                <option value="">Equipe toda</option>
                {setores.filter((s) => ehAdmin || s.id === usuario?.setor_id)
                  .map((s) => <option key={s.id} value={s.id}>Só {s.nome}</option>)}
              </select>
            </div>
          </div>
          <div className="campo"><label>Participantes ({f.participantes.length})</label>
            {equipe.length > 8 && (
              <input className="ev-busca" type="search" placeholder="Buscar pessoa..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            )}
            <div className="chips ev-chips">
              {filtrados.map((p) => (
                <button type="button" key={p.id} className={`chip ${f.participantes.includes(p.id) ? 'on' : ''}`} onClick={() => alternar(p.id)}>
                  {p.nome}
                </button>
              ))}
            </div>
            <small className="dica">Quem for marcado vê o evento mesmo sendo de outro setor e recebe aviso no aparelho.</small>
          </div>
          <div className="campo"><label>Descrição</label>
            <textarea value={f.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Pauta, o que levar, observações" />
          </div>
          {!f.hora_inicio && <small className="dica">Sem horário de início, o evento vale para o dia todo.</small>}
        </div>
        <div className="modal-rodape">
          {!novo && <button className="btn btn-perigo" style={{ marginRight: 'auto' }} onClick={excluir}>Excluir</button>}
          <button className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}

export default function CalendarioEquipe() {
  const { usuario } = useAuth();
  const { recarregar: recarregarHoje } = useAgenda();
  const [params] = useSearchParams();
  const [ref, setRef] = useState(() => {
    const d = params.get('data');
    return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? new Date(`${d}T12:00:00`) : new Date();
  });
  const [eventos, setEventos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [soMeus, setSoMeus] = useState(false);
  const [modal, setModal] = useState(null); // { evento } ou { data }

  const ano = ref.getFullYear();
  const mes = ref.getMonth();

  // a grade mostra 6 semanas a partir do domingo antes do dia 1
  const celulasBase = useMemo(() => {
    const primeiro = new Date(ano, mes, 1);
    const cursor = new Date(primeiro);
    cursor.setDate(1 - primeiro.getDay());
    const lista = [];
    for (let i = 0; i < 42; i++) {
      lista.push({ iso: isoLocal(cursor), fora: cursor.getMonth() !== mes, numero: cursor.getDate() });
      cursor.setDate(cursor.getDate() + 1);
    }
    return lista;
  }, [ano, mes]);

  const de = celulasBase[0].iso;
  const ate = celulasBase[celulasBase.length - 1].iso;

  const carregar = useCallback(async () => {
    setErro('');
    try { setEventos((await API.get(`/api/eventos?de=${de}&ate=${ate}`)).eventos || []); }
    catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }, [de, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  const meu = (e) => e.criado_por === usuario?.id || (e.participantes || []).some((p) => p.id === usuario?.id);
  const visiveis = soMeus ? eventos.filter(meu) : eventos;
  const porData = {};
  visiveis.forEach((e) => { (porData[e.data] = porData[e.data] || []).push(e); });
  const hoje = isoLocal();

  const aoSalvar = () => { setModal(null); carregar(); recarregarHoje(); };

  return (
    <>
      <div className="cal-topo">
        <span className="mes">{MESES[mes]} {ano}</span>
        <label className="ev-filtro">
          <input type="checkbox" checked={soMeus} onChange={(e) => setSoMeus(e.target.checked)} /> Só os meus
        </label>
        <div className="cal-nav">
          <button onClick={() => setRef(new Date(ano, mes - 1, 1))} title="Mês anterior" aria-label="Mês anterior">‹</button>
          <button onClick={() => setRef(new Date())} title="Hoje">Hoje</button>
          <button onClick={() => setRef(new Date(ano, mes + 1, 1))} title="Próximo mês" aria-label="Próximo mês">›</button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ data: hoje })}>+ Novo evento</button>
      </div>

      {erro && <div className="vazio"><b>Não foi possível carregar</b>{erro}</div>}

      {carregando ? <div className="carregando"><div className="spinner" />Carregando...</div> : (
        <div className="calendario cal-equipe">
          {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {celulasBase.map((c) => (
            <div
              key={c.iso}
              className={`cal-dia ${c.fora ? 'fora' : ''} ${c.iso === hoje ? 'hoje' : ''}`}
              onClick={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('num')) setModal({ data: c.iso }); }}
              title="Clique num espaço vazio para marcar um evento neste dia"
            >
              <span className="num">{c.numero}</span>
              <div className="cal-tarefas">
                {(porData[c.iso] || []).map((ev) => (
                  <button
                    type="button" key={ev.id}
                    className={`cal-tarefa ev-chip ${meu(ev) ? 'meu' : ''} ${ev.setor_id ? 'setor' : ''}`}
                    onClick={() => setModal({ evento: ev })}
                    title={`${ev.hora_inicio || 'Dia todo'} · ${ev.titulo}${ev.local ? ' · ' + ev.local : ''}`}
                  >
                    {ev.hora_inicio ? <b>{ev.hora_inicio}</b> : null} {ev.titulo}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ev-legenda">
        <span><i className="ev-cor geral" /> Equipe toda</span>
        <span><i className="ev-cor setor" /> Só de um setor</span>
        <span><i className="ev-cor meu" /> Você participa</span>
      </div>

      {modal && (
        <ModalEvento
          evento={modal.evento || null}
          dataInicial={modal.data}
          onFechar={() => setModal(null)}
          onSalvo={aoSalvar}
        />
      )}
    </>
  );
}
