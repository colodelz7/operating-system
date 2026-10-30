import TextosSalvos from '../components/TextosSalvos';

// Biblioteca da equipe: todos veem; edita quem criou ou o admin.
export default function Prompts() {
  return (
    <TextosSalvos
      base="/api/prompts" mascote
      rotulos={{
        titulo: 'Prompts', singular: 'prompt', Singular: 'Prompt', artigo: 'o', nov: 'Novo',
        vazioGlyph: '</>', vazioTexto: 'Salve seus prompts aqui pra achar e reusar depois.',
      }}
    />
  );
}
