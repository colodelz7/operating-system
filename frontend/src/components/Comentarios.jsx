import { useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { iniciais } from '../lib/format';

/* Comentários da tarefa.

   O autor vem sempre da sessão: o navegador manda só o texto. Apagar é do
   próprio autor (ou do Atendimento), e quem decide isso é o servidor, aqui
   a gente só esconde o botão de quem não pode. */

export default function Comentarios({ tarefaId, onMudou, formatarQuando }) {
  const { usuario, ehAdmin } = useAuth();
  const toast = useToast();

  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [txt, setTxt] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await API.get(`/api/tarefas/${tarefaId}/comentarios`);
      setLista(r.comentarios || []);
    } catch (_) { /* sem acesso ou tarefa recém-excluída: fica vazio */ }
    finally { setCarregando(false); }
  }, [tarefaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const enviar = async (e) => {
    e.preventDefault();
    const frase = txt.trim();
    if (!frase || enviando) return;
    setEnviando(true);
    try {
      const r = await API.post(`/api/tarefas/${tarefaId}/comentarios`, { texto: frase });
      setLista((l) => [...l, r.comentario]);
      setTxt('');
      onMudou?.();
    } catch (err) { toast(err.message, 'erro'); }
    finally { setEnviando(false); }
  };

  const excluir = async (c) => {
    try {
      await API.del(`/api/tarefas/${tarefaId}/comentarios/${c.id}`);
      setLista((l) => l.filter((x) => x.id !== c.id));
      onMudou?.();
    } catch (err) { toast(err.message, 'erro'); }
  };

  return (
    <div className="coment" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--linha)' }}>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Comentários ({lista.length})</label>

      <div className="coment-lista">
        {carregando ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 0' }}>Carregando...</div>
        ) : lista.length ? lista.map((c) => (
          <div key={c.id} className="coment-item">
            <span className="avatar">{iniciais(c.usuario_nome)}</span>
            <div className="coment-corpo">
              <div className="coment-topo">
                <b>{c.usuario_nome}</b>
                <span className="coment-quando">{formatarQuando ? formatarQuando(c.criado_em) : ''}</span>
                {(ehAdmin || c.usuario_id === usuario?.id) && (
                  <button className="coment-del" title="Remover" onClick={() => excluir(c)}>×</button>
                )}
              </div>
              <div className="coment-txt">{c.texto}</div>
            </div>
          </div>
        )) : <div style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 0' }}>Nenhum comentário ainda.</div>}
      </div>

      <form className="coment-form" onSubmit={enviar}>
        <input value={txt} onChange={(e) => setTxt(e.target.value)}
          placeholder="Escreva um comentário…" maxLength={2000} aria-label="Novo comentário" />
        <button className="btn btn-primary" disabled={enviando || !txt.trim()}>
          {enviando ? '...' : 'Comentar'}
        </button>
      </form>
    </div>
  );
}
