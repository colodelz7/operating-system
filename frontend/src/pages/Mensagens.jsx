import TextosSalvos from '../components/TextosSalvos';

// Respostas prontas PESSOAIS: so o dono ve.
export default function Mensagens() {
  return (
    <TextosSalvos
      base="/api/mensagens-salvas" pessoal
      rotulos={{
        titulo: 'Mensagens', singular: 'mensagem', Singular: 'Mensagem', artigo: 'a', nov: 'Nova',
        vazioGlyph: '✉', vazioTexto: 'Guarde aqui as mensagens que você manda sempre. Só você vê.',
      }}
    />
  );
}
