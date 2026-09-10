import { useState, useEffect } from 'react';

/* Anexos com pré-visualização.

   Imagem e PDF aparecem como miniatura e abrem grandes num visualizador
   dentro da própria tela. Os outros tipos continuam como link de download,
   que é o que dá para fazer com segurança: o servidor só devolve inline os
   formatos que o navegador exibe sem risco (SVG, por exemplo, fica de fora
   de propósito, porque é um documento que pode carregar script). */

const EH_IMAGEM = (mime) => /^image\/(png|jpeg|gif|webp)$/.test(String(mime || ''));
const EH_PDF = (mime) => String(mime || '') === 'application/pdf';
const TEM_PREVIA = (a) => EH_IMAGEM(a.mime) || EH_PDF(a.mime);

function tamanhoLegivel(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Visualizador({ anexo, onFechar }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar]);

  if (!anexo) return null;
  const src = `/api/anexos/${anexo.id}/preview`;

  return (
    <div className="visualizador" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="visualizador-topo">
        <span className="visualizador-nome">{anexo.nome_original}</span>
        <a className="btn btn-ghost btn-sm" href={`/api/anexos/${anexo.id}`}>Baixar</a>
        <button className="btn btn-ghost btn-sm" onClick={onFechar} aria-label="Fechar">✕</button>
      </div>
      <div className="visualizador-corpo">
        {EH_IMAGEM(anexo.mime)
          ? <img src={src} alt={anexo.nome_original} />
          : <iframe src={src} title={anexo.nome_original} />}
      </div>
    </div>
  );
}

export default function Anexos({ anexos }) {
  const [aberto, setAberto] = useState(null);
  const lista = anexos || [];

  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600 }}>
        Anexos {lista.length ? `(${lista.length})` : ''}
      </label>

      {!lista.length ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>Nenhum anexo</div>
      ) : (
        <div className="anexos-grade">
          {lista.map((a) => (
            TEM_PREVIA(a) ? (
              <button key={a.id} type="button" className="anexo-cartao" onClick={() => setAberto(a)}
                title={`${a.nome_original} · ${tamanhoLegivel(a.tamanho)}`}>
                <span className="anexo-previa">
                  {EH_IMAGEM(a.mime)
                    ? <img src={`/api/anexos/${a.id}/preview`} alt="" loading="lazy" />
                    : <span className="anexo-pdf">PDF</span>}
                </span>
                <span className="anexo-nome">{a.nome_original}</span>
              </button>
            ) : (
              <a key={a.id} className="anexo-cartao" href={`/api/anexos/${a.id}`}
                title={`${a.nome_original} · ${tamanhoLegivel(a.tamanho)}`}>
                <span className="anexo-previa"><span className="anexo-generico">📎</span></span>
                <span className="anexo-nome">{a.nome_original}</span>
              </a>
            )
          ))}
        </div>
      )}

      <Visualizador anexo={aberto} onFechar={() => setAberto(null)} />
    </div>
  );
}
