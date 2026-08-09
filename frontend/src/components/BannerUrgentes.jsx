export default function BannerUrgentes({ tarefas }) {
  const urg = (tarefas || []).filter((t) => t.prioridade === 'urgente' && !t.coluna_conclusao);
  if (!urg.length) return null;
  const plural = urg.length > 1;
  return (
    <div className="banner-urgente">
      <span className="bu-ico">!</span>
      <span>
        <b>{urg.length} tarefa{plural ? 's' : ''} urgente{plural ? 's' : ''}</b> aguardando ação neste setor. Priorize.
      </span>
    </div>
  );
}
