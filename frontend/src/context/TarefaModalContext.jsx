import { createContext, useContext, useState, useCallback } from 'react';
import { useApp } from './AppContext';
import { useNotificacoes } from './NotificacoesContext';
import TarefaModal from '../components/TarefaModal';
import TarefaDetalheModal from '../components/TarefaDetalheModal';

/* Orquestra os modais de tarefa (equivalente ao antigo container #modais).
   Qualquer tela chama abrirNova / abrirDetalhe. Ao salvar/mover/excluir,
   dispara refresh do app e recarrega notificacoes. */
const TarefaModalCtx = createContext(null);
export const useTarefaModal = () => useContext(TarefaModalCtx);

export function TarefaModalProvider({ children }) {
  const { refresh, setorAtivo } = useApp();
  const { recarregar } = useNotificacoes();
  const [estado, setEstado] = useState({ modo: null, setorId: null, tarefa: null, id: null });

  const fechar = useCallback(() => setEstado({ modo: null, setorId: null, tarefa: null, id: null }), []);

  const abrirNova = useCallback(({ setorId } = {}) => {
    // 'todos' passa adiante: o TarefaModal mostra o seletor de setor (admin).
    const sid = setorId ?? setorAtivo;
    setEstado({ modo: 'form', setorId: sid, tarefa: null, id: null });
  }, [setorAtivo]);

  const abrirEditar = useCallback((tarefa) => {
    setEstado({ modo: 'form', setorId: tarefa.setor_id, tarefa, id: null });
  }, []);

  const abrirDetalhe = useCallback((id) => {
    setEstado({ modo: 'detalhe', setorId: null, tarefa: null, id });
  }, []);

  const aoSalvar = useCallback(() => { refresh(); recarregar(); }, [refresh, recarregar]);

  return (
    <TarefaModalCtx.Provider value={{ abrirNova, abrirEditar, abrirDetalhe, fechar }}>
      {children}
      {estado.modo === 'form' && (
        <TarefaModal
          setorId={estado.setorId}
          tarefa={estado.tarefa}
          onClose={fechar}
          onSaved={aoSalvar}
        />
      )}
      {estado.modo === 'detalhe' && (
        <TarefaDetalheModal
          id={estado.id}
          onClose={fechar}
          onEditar={(t) => abrirEditar(t)}
          onMudou={aoSalvar}
        />
      )}
    </TarefaModalCtx.Provider>
  );
}
