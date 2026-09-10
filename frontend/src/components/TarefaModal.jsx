import { useState, useEffect, useRef } from 'react';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useApp } from '../context/AppContext';
import EditorDescricao from './EditorDescricao';

/* Modal de criar/editar tarefa. Portado do ViewKanban.abrirModalTarefa.
   Na criação, o admin escolhe primeiro o SETOR; colunas e responsáveis
   recarregam de acordo (membro cria sempre no próprio setor). */
export default function TarefaModal({ setorId, tarefa, onClose, onSaved }) {
  const { ehAdmin } = useAuth();
  const { setores } = useApp();
  const toast = useToast();
  const ed = !!tarefa;

  // setor efetivo do formulário: edição usa o da tarefa; criação começa no
  // setor da tela (ou no primeiro disponível) e o admin pode trocar.
  const [setorSel, setSetorSel] = useState(() => {
    if (ed) return tarefa.setor_id;
    if (setorId && setorId !== 'todos') return Number(setorId);
    return setores[0]?.id ?? null;
  });

  const [carregando, setCarregando] = useState(true);
  const [colunas, setColunas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [respSel, setRespSel] = useState(new Set((tarefa?.responsaveis || []).map((r) => r.id)));
  const [salvando, setSalvando] = useState(false);
  const [duplicando, setDuplicando] = useState(false);
  const anexoRef = useRef(null);

  const [form, setForm] = useState({
    titulo: tarefa?.titulo || '',
    descricao: tarefa?.descricao || '',
    cliente_id: tarefa?.cliente_id || '',
    prioridade: tarefa?.prioridade || 'normal',
    coluna_id: '',
    data_inicio: tarefa?.data_inicio ? tarefa.data_inicio.slice(0, 10) : '',
    data_entrega: tarefa?.data_entrega ? tarefa.data_entrega.slice(0, 10) : '',
    data_publicacao: tarefa?.data_publicacao ? tarefa.data_publicacao.slice(0, 10) : '',
    recorrencia: tarefa?.recorrencia || '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Duplicar: cria uma tarefa nova com o mesmo conteudo, no inicio do fluxo.
  // Nao leva anexos, comentarios nem recorrencia, e uma tarefa nova, nao uma
  // continuacao da atual.
  async function duplicar() {
    if (!ed || duplicando) return;
    setDuplicando(true);
    try {
      const r = await API.post(`/api/tarefas/${tarefa.id}/duplicar`, {});
      toast(`Cópia criada: "${r.tarefa.titulo}" ✓`, 'ok');
      onSaved?.();
      onClose();
    } catch (e) { toast(e.message, 'erro'); }
    finally { setDuplicando(false); }
  }

  // Recarrega colunas e responsáveis sempre que o setor do formulário muda.
  useEffect(() => {
    if (setorSel == null) { toast('Nenhum setor disponível', 'erro'); onClose(); return; }
    let vivo = true;
    setCarregando(true);
    (async () => {
      try {
        const [rc, rcli, rus] = await Promise.all([
          API.get(`/api/setores/${setorSel}/colunas`),
          API.get('/api/clientes'),
          API.get(`/api/setores/${setorSel}/usuarios`),
        ]);
        if (!vivo) return;
        setColunas(rc.colunas);
        setClientes(rcli.clientes);
        setUsuarios(rus.usuarios);
        setForm((f) => ({ ...f, coluna_id: rc.colunas[0] ? rc.colunas[0].id : '' }));
        // responsáveis marcados que não são do novo setor saem da seleção
        setRespSel((s) => new Set([...s].filter((id) => rus.usuarios.some((u) => u.id === id))));
      } catch (e) { toast(e.message, 'erro'); onClose(); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [setorSel, toast, onClose]);

  const toggleResp = (uid) => setRespSel((s) => {
    const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n;
  });

  async function salvar() {
    if (!form.titulo.trim()) { toast('Informe o título', 'erro'); return; }
    setSalvando(true);
    const dados = {
      titulo: form.titulo.trim(),
      descricao: form.descricao.trim(),
      cliente_id: form.cliente_id || null,
      prioridade: form.prioridade,
      data_inicio: form.data_inicio || null,
      data_entrega: form.data_entrega || null,
      data_publicacao: form.data_publicacao || null,
      responsaveis: [...respSel],
    };
    try {
      if (ed) {
        dados.recorrencia = form.recorrencia || null;
        await API.put(`/api/tarefas/${tarefa.id}`, dados);
        const arq = anexoRef.current;
        if (arq && arq.files[0]) {
          const fd = new FormData(); fd.append('arquivo', arq.files[0]);
          await API.post(`/api/tarefas/${tarefa.id}/anexos`, fd, true);
        }
        toast('Alterações salvas', 'ok');
      } else {
        dados.setor_id = Number(setorSel);
        dados.coluna_id = form.coluna_id;
        dados.recorrencia = form.recorrencia || null;
        await API.post('/api/tarefas', dados);
        toast('Tarefa criada ✓', 'ok');
      }
      onSaved();
      onClose();
    } catch (e) { toast(e.message, 'erro'); setSalvando(false); }
  }

  async function excluir() {
    if (!confirm('Excluir esta tarefa? Esta ação não pode ser desfeita.')) return;
    try { await API.del(`/api/tarefas/${tarefa.id}`); toast('Tarefa excluída', 'ok'); onSaved(); onClose(); }
    catch (e) { toast(e.message, 'erro'); }
  }

  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-topo">
          <h3>{ed ? 'Editar tarefa' : 'Nova tarefa'}</h3>
          <button className="fechar" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-corpo">
          {!ed && setores.length > 1 && (
            <div className="campo">
              <label>Setor da tarefa</label>
              <select value={setorSel ?? ''} onChange={(e) => setSetorSel(Number(e.target.value))}>
                {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
          )}
          {carregando ? <div className="carregando"><div className="spinner" />Carregando...</div> : (
            <>
              <div className="campo">
                <label>Título</label>
                <input value={form.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ex: Cliente Exemplo, 2 estáticos" />
              </div>
              <div className="campo">
                <label>Descrição</label>
                <EditorDescricao value={form.descricao} onChange={(v) => set('descricao', v)} />
              </div>
              <div className="grid-2">
                <div className="campo">
                  <label>Cliente (opcional)</label>
                  <select value={form.cliente_id} onChange={(e) => set('cliente_id', e.target.value)}>
                    <option value="">Sem cliente</option>
                    {clientes.map((c) => <option key={c.id} value={c.id}>{c.empresa}</option>)}
                  </select>
                </div>
                <div className="campo">
                  <label>Urgência</label>
                  <select value={form.prioridade} onChange={(e) => set('prioridade', e.target.value)}>
                    <option value="baixa">Baixa (5 dias)</option>
                    <option value="normal">Normal (3 dias)</option>
                    <option value="alta">Alta (1 dia)</option>
                    <option value="urgente">Urgente (agora)</option>
                  </select>
                </div>
              </div>
              {!ed ? (
                <div className="grid-2">
                  <div className="campo">
                    <label>Coluna inicial</label>
                    <select value={form.coluna_id} onChange={(e) => set('coluna_id', e.target.value)}>
                      {colunas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                  <div className="campo">
                    <label>Recorrência</label>
                    <select value={form.recorrencia} onChange={(e) => set('recorrencia', e.target.value)}>
                      <option value="">Sem recorrência</option>
                      <option value="diaria">Todo dia</option>
                      <option value="semanal">Toda semana</option>
                      <option value="mensal">Todo mês</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="campo">
                  <label>Recorrência</label>
                  <select value={form.recorrencia} onChange={(e) => set('recorrencia', e.target.value)}>
                    <option value="">Sem recorrência</option>
                    <option value="diaria">Todo dia</option>
                    <option value="semanal">Toda semana</option>
                    <option value="mensal">Todo mês</option>
                  </select>
                </div>
              )}
              <div className="grid-2">
                <div className="campo"><label>Início</label><input type="date" value={form.data_inicio} onChange={(e) => set('data_inicio', e.target.value)} /></div>
                <div className="campo"><label>Entrega</label><input type="date" value={form.data_entrega} onChange={(e) => set('data_entrega', e.target.value)} /></div>
              </div>
              <div className="campo">
                <label>Responsáveis</label>
                <div className="chips">
                  {usuarios.length ? usuarios.map((u) => (
                    <button type="button" key={u.id} className={`chip ${respSel.has(u.id) ? 'on' : ''}`} onClick={() => toggleResp(u.id)}>{u.nome}</button>
                  )) : <span style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhum usuário neste setor.</span>}
                </div>
              </div>
              {ed && <div className="campo"><label>Anexo (até 25MB)</label><input type="file" ref={anexoRef} /></div>}
            </>
          )}
        </div>
        <div className="modal-rodape">
          {ed && ehAdmin && <button className="btn btn-perigo" onClick={excluir}>Excluir</button>}
          {ed && (
            <button className="btn btn-ghost" onClick={duplicar} disabled={duplicando || salvando}
              title="Cria uma cópia desta tarefa no início do fluxo">
              {duplicando ? 'Duplicando...' : 'Duplicar'}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando || carregando}>{ed ? 'Salvar alterações' : 'Criar tarefa'}</button>
        </div>
      </div>
    </div>
  );
}
