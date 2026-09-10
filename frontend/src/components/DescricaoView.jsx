/* Renderiza a descrição da tarefa como blocos (estilo Notion, leve):
   títulos, listas, lista numerada, checklist interativo, tabela, destaque.
   Seguro: monta elementos React (sem HTML cru). onToggle(lineIdx) alterna
   um item de checklist alterando a linha correspondente no texto original. */

const RE_H = /^(#{1,3})\s+(.*)$/;
const RE_TASK = /^\s*(?:[-*]\s+)?\[([ xX])\]\s+(.*)$/;
const RE_TASK2 = /^\s*\(([ xX])\)\s+(.*)$/;
const RE_BULLET = /^\s*[-*]\s+(.*)$/;
const RE_NUM = /^\s*\d+[.)]\s+(.*)$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_TABLE = /^\s*\|(.+)\|\s*$/;
const RE_SEP = /^\s*\|?\s*:?-{2,}.*$/; // linha separadora de tabela

// monta um <a> clicavel (abre em nova aba; nao propaga o clique pro card/modal).
// Seguranca: so http/https/mailto viram link. Qualquer outro esquema
// (javascript:, data:, vbscript:, etc) e neutralizado e vira texto puro, evita
// XSS por link malicioso plantado numa descricao (conteudo compartilhado).
function link(url, texto, key) {
  const raw = String(url || '').trim();
  const href = /^www\./i.test(raw) ? `https://${raw}` : raw;
  if (!/^(https?:|mailto:)/i.test(href)) return <span key={key}>{texto || url}</span>;
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer"
      className="desc-link" onClick={(e) => e.stopPropagation()}>{texto || url}</a>
  );
}

// formatação inline: [texto](url), URL nua (http/https/www), **negrito**, *itálico*, `código`
function inline(str, key) {
  const out = [];
  const re = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|((?:https?:\/\/|www\.)[^\s<]+)/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push(str.slice(last, m.index));
    if (m[1] != null) {                 // [texto](url)
      out.push(link(m[3], m[2], `${key}-${i++}`));
    } else if (m[4] != null) {          // **negrito**
      out.push(<strong key={`${key}-${i++}`}>{m[5]}</strong>);
    } else if (m[6] != null) {          // *itálico*
      out.push(<em key={`${key}-${i++}`}>{m[7]}</em>);
    } else if (m[8] != null) {          // `código`
      out.push(<code key={`${key}-${i++}`}>{m[9]}</code>);
    } else if (m[10] != null) {         // URL nua, tira pontuação final do link
      let url = m[10];
      const t = url.match(/[.,;:!?)\]]+$/);
      const cauda = t ? t[0] : '';
      if (cauda) url = url.slice(0, -cauda.length);
      out.push(link(url, url, `${key}-${i++}`));
      if (cauda) out.push(cauda);
    }
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push(str.slice(last));
  return out.length ? out : [str];
}

function parse(texto) {
  const linhas = (texto || '').replace(/\r/g, '').split('\n');
  const blocos = [];
  let i = 0;
  while (i < linhas.length) {
    const ln = linhas[i];
    let m;
    if ((m = ln.match(RE_H))) { blocos.push({ t: 'h', nivel: m[1].length, txt: m[2], i }); i++; continue; }
    if ((m = ln.match(RE_QUOTE))) {
      const itens = [];
      while (i < linhas.length && (m = linhas[i].match(RE_QUOTE))) { itens.push(m[1]); i++; }
      blocos.push({ t: 'quote', txt: itens.join('\n') }); continue;
    }
    if (ln.match(RE_TASK) || ln.match(RE_TASK2)) {
      const itens = [];
      while (i < linhas.length) {
        const mm = linhas[i].match(RE_TASK) || linhas[i].match(RE_TASK2);
        if (!mm) break;
        itens.push({ marcado: mm[1].toLowerCase() === 'x', txt: mm[2], i });
        i++;
      }
      blocos.push({ t: 'task', itens }); continue;
    }
    if (ln.match(RE_TABLE)) {
      const rows = [];
      while (i < linhas.length && linhas[i].match(RE_TABLE)) {
        if (!RE_SEP.test(linhas[i])) {
          rows.push(linhas[i].replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()));
        }
        i++;
      }
      if (rows.length) blocos.push({ t: 'table', rows }); continue;
    }
    if ((m = ln.match(RE_NUM))) {
      const itens = [];
      while (i < linhas.length && (m = linhas[i].match(RE_NUM))) { itens.push(m[1]); i++; }
      blocos.push({ t: 'ol', itens }); continue;
    }
    if ((m = ln.match(RE_BULLET))) {
      const itens = [];
      while (i < linhas.length && (m = linhas[i].match(RE_BULLET))) { itens.push(m[1]); i++; }
      blocos.push({ t: 'ul', itens }); continue;
    }
    if (ln.trim() === '') { i++; continue; }
    // parágrafo: junta linhas de texto consecutivas
    const par = [];
    while (i < linhas.length && linhas[i].trim() !== ''
      && !linhas[i].match(RE_H) && !linhas[i].match(RE_QUOTE)
      && !linhas[i].match(RE_TASK) && !linhas[i].match(RE_TASK2)
      && !linhas[i].match(RE_TABLE) && !linhas[i].match(RE_NUM) && !linhas[i].match(RE_BULLET)) {
      par.push(linhas[i]); i++;
    }
    blocos.push({ t: 'p', txt: par.join('\n') });
  }
  return blocos;
}

export default function DescricaoView({ texto, onToggle }) {
  if (!texto || !texto.trim()) {
    return <p style={{ margin: '10px 0 16px', color: 'var(--muted)' }}>Sem descrição</p>;
  }
  const blocos = parse(texto);
  return (
    <div className="tarefa-desc">
      {blocos.map((b, k) => {
        if (b.t === 'h') {
          const H = `h${Math.min(b.nivel + 2, 5)}`;
          return <H key={k} className="desc-h">{inline(b.txt, k)}</H>;
        }
        if (b.t === 'quote') return <blockquote key={k} className="desc-callout">{inline(b.txt, k)}</blockquote>;
        if (b.t === 'ul') return <ul key={k} className="desc-ul">{b.itens.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>;
        if (b.t === 'ol') return <ol key={k} className="desc-ol">{b.itens.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>;
        if (b.t === 'task') {
          return (
            <div key={k} className="desc-checklist">
              {b.itens.map((it) => (
                <label key={it.i} className={`chk-item ${it.marcado ? 'done' : ''}`}>
                  <input type="checkbox" checked={it.marcado}
                    onChange={() => onToggle && onToggle(it.i)} />
                  <span>{inline(it.txt, `t${it.i}`)}</span>
                </label>
              ))}
            </div>
          );
        }
        if (b.t === 'table') {
          const [head, ...body] = b.rows;
          return (
            <div key={k} className="desc-table-wrap">
              <table className="desc-table">
                <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `h${k}-${j}`)}</th>)}</tr></thead>
                <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `b${k}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return <p key={k} className="desc-p">{b.txt.split('\n').map((l, j) => <span key={j}>{inline(l, `${k}-${j}`)}{j < b.txt.split('\n').length - 1 ? <br /> : null}</span>)}</p>;
      })}
    </div>
  );
}
