import { useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTarefaModal } from '../context/TarefaModalContext';
import { RECORRENCIAS } from '../lib/constants';
import { formatarDataLonga } from '../lib/format';

/* Painel das tarefas que se repetem. Cada linha e a ocorrencia mais recente
   da serie: mudar a frequencia, o limite ou parar vale para as proximas
   (a proxima nasce quando esta e concluida ou quando a entrega passa). */

function LinhaSerie({ t, onMudou }) {
  const toast = useToast();
  const { abrirDetalhe } = useTarefaModal();
  const [freq, setFreq] = useState(t.recorrencia);
  const [ate, setAte] = useState(t.recorrencia_ate || '');
  const [salvando, setSalvando] = useState(false);
  const mudou = freq !== t.recorrencia || (ate || null) !== (t.recorrencia_ate || null);

  async function salvar(corpo, msg) {
    setSalvando(true);
    try { await API.put(`/api/tarefas/${t.id}`, corpo); toast(msg, 'ok'); onMudou(); }
    catch (e) { toast(e.message, 'erro'); }
    finally { setSalvando(false); }
  }

  const parar = () => {
    if (!window.confirm(`Parar de repetir "${t.titulo}"? A tarefa atual continua no quadro.`)) return;
    salvar({ recorrencia: null, recorrencia_ate: null }, 'A tarefa não vai mais se repetir');
  };

  return (
    <div className="rec-linha">
      <button className="rec-titulo" onClick={() => abrirDetalhe(t.id)} title="Abrir a tarefa">
        <b>{t.titulo}</b>
        <small>
          {t.setor_nome}{t.cliente_nome ? ` · ${t.cliente_nome}` : ''}
          {t.data_entrega ? ` · próxima entrega ${formatarDataLonga(t.data_entrega)}` : ''}
        </small>
      </button>
      <label>Repete
        <select value={freq} onChange={(e) => setFreq(e.target.value)}>
          {Object.entries(RECORRENCIAS).map(([k, rot]) => <option key={k} value={k}>{rot}</option>)}
        </select>
      </label>
      <label>Até
        <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} title="Em branco: repete sem data para acabar" />
      </label>
      <div className="rec-acoes">
        <button className="btn btn-primary btn-sm" disabled={!mudou || salvando}
          onClick={() => salvar({ recorrencia: freq, recorrencia_ate: ate || null }, 'Repetição atualizada ✓')}>Salvar</button>
        <button className="btn btn-ghost btn-sm" disabled={salvando} onClick={parar}>Parar</button>
      </div>
    </div>
  );
}

export default function RecorrentesPanel({ onFechar }) {
  const { setorAtivo, refresh } = useApp();
  const [tarefas, setTarefas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    const url = setorAtivo && setorAtivo !== 'todos' ? `/api/tarefas/recorrentes?setor=${setorAtivo}` : '/api/tarefas/recorrentes';
    try { setTarefas((await API.get(url)).tarefas || []); setErro(''); }
    catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }, [setorAtivo]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar]);

  // recarrega o painel e o quadro que esta atras dele
  const aoMudar = () => { carregar(); refresh(); };

  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal rec-modal" role="dialog" aria-label="Tarefas recorrentes">
        <div className="modal-topo">
          <h3>Tarefas que se repetem</h3>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">&times;</button>
        </div>
        <div className="modal-corpo">
          {erro && <div className="form-erro" style={{ display: 'block' }}>{erro}</div>}
          {carregando ? <div className="carregando"><div className="spinner" /></div>
            : tarefas.length ? tarefas.map((t) => <LinhaSerie key={t.id} t={t} onMudou={aoMudar} />)
              : (
                <div className="vazio">
                  <b>Nenhuma tarefa recorrente</b>
                  Para criar uma, abra a tarefa e escolha com que frequência ela se repete.
                </div>
              )}
        </div>
      </div>
    </div>
  );
}
