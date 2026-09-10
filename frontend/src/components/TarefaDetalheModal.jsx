import { useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatarDataLonga, formatarDuracao, formatarQuando } from '../lib/format';
import DescricaoView from './DescricaoView';
import Anexos from './Anexos';
import Comentarios from './Comentarios';

/* Modal de detalhe da tarefa.
   O Status é editável aqui: mover a tarefa de coluna por qualquer tela,
   inclusive o Calendário. Usa o mesmo PATCH /mover do Kanban, então
   cronômetro, conclusão, notificação e recorrência seguem a lógica de
   sempre. */

const ROTULO_RECORRENCIA = {
  diaria: 'todo dia',
  semanal: 'toda semana',
  quinzenal: 'a cada 15 dias',
  mensal: 'todo mês',
};

export default function TarefaDetalheModal({ id, onClose, onEditar, onMudou }) {
  const { ehAdmin } = useAuth();
  const toast = useToast();
  const [t, setT] = useState(null);
  const [colunas, setColunas] = useState([]);
  const [movendo, setMovendo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await API.get(`/api/tarefas/${id}`);
      setT(r.tarefa);
      try {
        const rc = await API.get(`/api/setores/${r.tarefa.setor_id}/colunas`);
        setColunas(rc.colunas || []);
      } catch { /* sem acesso às colunas: status vira somente leitura */ }
    } catch (e) { toast(e.message, 'erro'); onClose(); }
  }, [id, toast, onClose]);

  useEffect(() => { carregar(); }, [carregar]);

  async function mudarStatus(colunaId) {
    if (!t || Number(colunaId) === t.coluna_id) return;
    setMovendo(true);
    try {
      const r = await API.patch(`/api/tarefas/${t.id}/mover`, { coluna_id: Number(colunaId) });
      setT(r.tarefa || { ...t, coluna_id: Number(colunaId) });
      // tarefa recorrente concluída: o servidor já criou a próxima
      if (r.recorrente) {
        toast(`Concluída ✓ Próxima ocorrência criada para ${r.recorrente.data_entrega}`, 'ok');
      } else {
        toast('Status atualizado ✓', 'ok');
      }
      onMudou?.();
    } catch (e) { toast(e.message, 'erro'); }
    finally { setMovendo(false); }
  }

  // garante a coluna atual na lista mesmo se o usuário não a enxerga no quadro
  const opcoesStatus = (t && colunas.length && !colunas.some((c) => c.id === t.coluna_id))
    ? [{ id: t.coluna_id, nome: t.coluna_nome }, ...colunas]
    : colunas;

  // alterna um item de checklist (linha idx) direto no texto e salva
  async function toggleItem(idx) {
    if (!t) return;
    const linhas = (t.descricao || '').split('\n');
    const ln = linhas[idx] || '';
    let m = ln.match(/^(\s*)([-*]\s+)?\[([ xX])\]\s(.*)$/); // formato "- [ ] item"
    if (m) {
      const marcado = m[3].toLowerCase() === 'x';
      linhas[idx] = `${m[1]}${m[2] || '- '}[${marcado ? ' ' : 'x'}] ${m[4]}`;
    } else {
      m = ln.match(/^(\s*)\(([ xX])\)\s(.*)$/); // formato "( ) item"
      if (!m) return;
      const marcado = m[2].toLowerCase() === 'x';
      linhas[idx] = `${m[1]}(${marcado ? ' ' : 'x'}) ${m[3]}`;
    }
    const nova = linhas.join('\n');
    const anterior = t.descricao;
    setT({ ...t, descricao: nova });
    try { await API.put(`/api/tarefas/${t.id}`, { descricao: nova }); onMudou?.(); }
    catch (e) { toast(e.message, 'erro'); setT((x) => ({ ...x, descricao: anterior })); }
  }

  const Linha = ({ rot, children }) => (
    <div style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--linha)' }}>
      <span style={{ color: 'var(--muted)', width: 110, fontSize: 13 }}>{rot}</span>
      <span style={{ fontSize: 13 }}>{children}</span>
    </div>
  );

  const temRetrab = t && (t.retrabalho_design || t.retrabalho_edicao || t.retrabalho_pdf);

  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        {!t ? (
          <div className="modal-corpo"><div className="carregando"><div className="spinner" />Carregando...</div></div>
        ) : (
          <>
            <div className="modal-topo">
              <div>
                <div style={{ color: 'var(--royal)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {t.cliente_nome || 'Sem cliente'}
                </div>
                <h3 style={{ marginTop: 4 }}>{t.titulo}</h3>
              </div>
              <button className="fechar" onClick={onClose}>&times;</button>
            </div>
            <div className="modal-corpo">
              {t.atrasada && <span className="tag-atraso">Atrasado</span>}
              {t.recorrencia && (
                <span className="tag-recorrente" title={`Repete ${ROTULO_RECORRENCIA[t.recorrencia]}`}>
                  ↻ {ROTULO_RECORRENCIA[t.recorrencia] || t.recorrencia}
                </span>
              )}
              <div style={{ margin: '10px 0 16px' }}>
                <DescricaoView texto={t.descricao} onToggle={toggleItem} />
              </div>
              <Linha rot="Status">
                {(t.coluna_conclusao && !ehAdmin) ? (
                  <span title="Concluída, travada (só admin reabre)">{t.coluna_nome} 🔒</span>
                ) : opcoesStatus.length ? (
                  <select value={t.coluna_id} disabled={movendo}
                    onChange={(e) => mudarStatus(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: 8, border: '1.5px solid var(--linha)',
                             background: 'var(--surface-2)', color: 'var(--txt)', fontSize: 13, cursor: 'pointer' }}>
                    {opcoesStatus.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                ) : t.coluna_nome}
              </Linha>
              <Linha rot="Prioridade">{t.prioridade[0].toUpperCase() + t.prioridade.slice(1)}</Linha>
              <Linha rot="Início">{t.data_inicio ? formatarDataLonga(t.data_inicio) : '-'}</Linha>
              <Linha rot="Entrega">{t.data_entrega ? formatarDataLonga(t.data_entrega) : '-'}</Linha>
              {t.recorrencia ? (
                <Linha rot="Repetição">
                  {ROTULO_RECORRENCIA[t.recorrencia] || t.recorrencia}
                  {t.recorrencia_ate ? ` (até ${formatarDataLonga(t.recorrencia_ate)})` : ''}
                  {t.recorrencia_gerou_id > 0 ? ' · próxima já criada' : ''}
                </Linha>
              ) : null}
              <Linha rot="Tempo corrido">{formatarDuracao(t.tempo_ms)}</Linha>
              {temRetrab ? (
                <Linha rot="Retrabalho">Design {t.retrabalho_design || 0} · Edição {t.retrabalho_edicao || 0} · PDF {t.retrabalho_pdf || 0}</Linha>
              ) : null}
              <div style={{ marginTop: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Responsáveis</label>
                <div className="chips" style={{ marginTop: 6 }}>
                  {t.responsaveis.length ? t.responsaveis.map((r) => <span key={r.id} className="chip on">{r.nome}</span>)
                    : <span style={{ color: 'var(--muted)' }}>-</span>}
                </div>
              </div>

              <Anexos anexos={t.anexos || []} />

              <Comentarios tarefaId={t.id} onMudou={onMudou} formatarQuando={formatarQuando} />
            </div>
            <div className="modal-rodape">
              <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
              <button className="btn btn-primary" onClick={() => onEditar(t)}>Editar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
