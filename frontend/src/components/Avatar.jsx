import { useState } from 'react';
import { iniciais } from '../lib/format';

/* Foto de perfil quando a pessoa tem uma; iniciais quando nao tem ou quando
   a imagem falha. O ?v= muda junto com a foto, entao o cache nunca mostra a
   antiga. */
export default function Avatar({ pessoa, tamanho, className = '' }) {
  const caminho = pessoa?.avatar_path || '';
  // guarda QUAL foto falhou: trocar de foto volta a tentar
  const [falhou, setFalhou] = useState('');
  const comFoto = caminho && falhou !== caminho;
  const style = tamanho ? { width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.38) } : undefined;

  return (
    <span className={`avatar ${className}`} style={style} title={pessoa?.nome || ''}>
      {comFoto ? (
        <img
          className="avatar-img" alt="" loading="lazy"
          src={`/api/equipe/${pessoa.id}/avatar?v=${encodeURIComponent(caminho)}`}
          onError={() => setFalhou(caminho)}
        />
      ) : iniciais(pessoa?.nome)}
    </span>
  );
}
