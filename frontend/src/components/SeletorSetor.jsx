import { useApp } from '../context/AppContext';

// Seletor de setor usado no Kanban e Calendario. Aberto a todos: qualquer
// pessoa ve os quadros dos outros setores (a escrita continua restrita).
// A visao agregada "Todos" e exclusiva de admin.
export default function SeletorSetor() {
  const { ehAdmin, setores, setorAtivo, setSetorAtivo } = useApp();
  return (
    <div className="vg-filtro seletor-setor">
      {ehAdmin && (
        <button className={`chip-f ${setorAtivo === 'todos' ? 'on' : ''}`} onClick={() => setSetorAtivo('todos')}>
          <span className="pt" style={{ background: 'linear-gradient(135deg,var(--brand),var(--neon))' }} />Todos
        </button>
      )}
      {setores.map((s) => (
        <button key={s.id} className={`chip-f ${s.id === setorAtivo ? 'on' : ''}`} onClick={() => setSetorAtivo(s.id)}>
          <span className="pt" style={{ background: s.cor }} />{s.nome}
        </button>
      ))}
    </div>
  );
}
