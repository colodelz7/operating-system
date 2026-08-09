import { useRef, useState, useEffect } from 'react';

/* Editor de descrição estilo Notion (leve): textarea + barra de blocos +
   menu "/" para inserir lista de tarefas, lista, numerada, tabela, título e
   frase de destaque. Guarda markdown simples em texto — o DescricaoView
   renderiza. Enter continua listas automaticamente. */

const BLOCOS = [
  { key: 'task', ico: '☑', label: 'Lista de tarefas', desc: 'Checklist com caixinhas', tpl: '- [ ] ' },
  { key: 'ul', ico: '•', label: 'Lista', desc: 'Itens com marcador', tpl: '- ' },
  { key: 'ol', ico: '1.', label: 'Lista numerada', desc: '1, 2, 3…', tpl: '1. ' },
  { key: 'h', ico: 'H', label: 'Título', desc: 'Cabeçalho de seção', tpl: '## ' },
  { key: 'quote', ico: '❝', label: 'Frase de destaque', desc: 'Bloco em destaque', tpl: '> ' },
  { key: 'table', ico: '▦', label: 'Tabela', desc: '2 colunas', tpl: '| Coluna 1 | Coluna 2 |\n| --- | --- |\n|  |  |\n' },
];

/* ---- conversor de conteúdo colado (HTML) para o markdown simples ---- */
function inlineMd(node) {
  let s = '';
  node.childNodes.forEach((ch) => {
    if (ch.nodeType === 3) { s += ch.textContent.replace(/\s+/g, ' '); return; }
    if (ch.nodeType !== 1) return;
    const tag = ch.tagName.toLowerCase();
    const inner = inlineMd(ch);
    if (tag === 'br') s += '\n';
    else if (tag === 'strong' || tag === 'b') s += inner.trim() ? `**${inner.trim()}**` : '';
    else if (tag === 'em' || tag === 'i') s += inner.trim() ? `*${inner.trim()}*` : '';
    else if (tag === 'code') s += `\`${inner}\``;
    else if (tag === 'a') {
      // so gera link pra esquemas seguros (http/https/mailto/www); qualquer
      // outro (javascript:, data:...) vira texto puro — anti-XSS ao colar
      const href = (ch.getAttribute('href') || '').trim();
      const seguro = /^(https?:|mailto:)/i.test(href) || /^www\./i.test(href);
      s += seguro ? `[${inner}](${href})` : inner;
    }
    else if (tag === 'span') {
      const st = ch.getAttribute('style') || '';
      let x = inner;
      if (/font-style:\s*italic/.test(st) && x.trim()) x = `*${x.trim()}*`;
      if (/font-weight:\s*(bold|[6-9]00)/.test(st) && x.trim()) x = `**${x.trim()}**`;
      s += x;
    } else s += inner;
  });
  return s;
}
function temBlocoFilho(node) {
  return [...node.children].some((c) => /^(h[1-6]|ul|ol|table|blockquote|pre|p|div)$/.test(c.tagName.toLowerCase()));
}
function listaMd(ul, ordenada) {
  const itens = [...ul.children].filter((li) => li.tagName.toLowerCase() === 'li');
  return itens.map((li, i) => {
    const cb = li.querySelector('input[type=checkbox]');
    let inner = inlineMd(li).trim().replace(/\n+/g, ' ');
    let check = null;
    if (cb) check = cb.checked;
    else { const mm = inner.match(/^([☑☒✓✔☐□◻])\s*/); if (mm) { check = /[☑☒✓✔]/.test(mm[1]); inner = inner.slice(mm[0].length); } }
    if (check !== null) return `- [${check ? 'x' : ' '}] ${inner}`;
    return ordenada ? `${i + 1}. ${inner}` : `- ${inner}`;
  }).join('\n');
}
function tabelaMd(table) {
  const rows = [...table.querySelectorAll('tr')]
    .map((tr) => [...tr.children].map((td) => inlineMd(td).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const norm = (r) => { const c = r.slice(); while (c.length < cols) c.push(''); return c; };
  const head = norm(rows[0]);
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${norm(r).join(' | ')} |`)].join('\n');
}
function blocosMd(node) {
  if (!temBlocoFilho(node)) return inlineMd(node).replace(/\n{2,}/g, '\n').trim();
  const parts = [];
  node.childNodes.forEach((ch) => {
    if (ch.nodeType === 3) { const t = ch.textContent.trim(); if (t) parts.push(t); return; }
    if (ch.nodeType !== 1) return;
    const tag = ch.tagName.toLowerCase();
    let out = '';
    if (/^h[1-6]$/.test(tag)) out = `${'#'.repeat(Math.min(Number(tag[1]), 3))} ${inlineMd(ch).trim()}`;
    else if (tag === 'ul') out = listaMd(ch, false);
    else if (tag === 'ol') out = listaMd(ch, true);
    else if (tag === 'table') out = tabelaMd(ch);
    else if (tag === 'blockquote') out = inlineMd(ch).trim().split('\n').map((l) => `> ${l}`).join('\n');
    else if (tag === 'p' || tag === 'div') out = blocosMd(ch);
    else out = inlineMd(ch).trim();
    if (out && out.trim()) parts.push(out.trim());
  });
  return parts.join('\n\n');
}
function htmlParaMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style,script,meta,title').forEach((n) => n.remove());
  return blocosMd(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}

export default function EditorDescricao({ value, onChange, placeholder }) {
  const ref = useRef(null);
  const [menu, setMenu] = useState(null); // { query, start } | null
  const [sel, setSel] = useState(0);
  const caretPend = useRef(null);

  useEffect(() => {
    if (caretPend.current != null && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(caretPend.current, caretPend.current);
      caretPend.current = null;
    }
  });

  const opcoes = menu
    ? BLOCOS.filter((b) => !menu.query || (b.label.toLowerCase().includes(menu.query.toLowerCase())))
    : [];

  function aoDigitar(e) {
    const v = e.target.value;
    onChange(v);
    const caret = e.target.selectionStart;
    const antes = v.slice(0, caret);
    const m = antes.match(/(?:^|\s)\/(\p{L}*)$/u);
    if (m) { setMenu({ query: m[1], start: caret - m[1].length - 1 }); setSel(0); }
    else setMenu(null);
  }

  function inserir(bloco) {
    const v = value || '';
    const start = menu ? menu.start : (ref.current ? ref.current.selectionStart : v.length);
    const end = menu ? (ref.current ? ref.current.selectionStart : start) : start;
    // se não estiver no início da linha, quebra antes
    const precisaQuebra = start > 0 && v[start - 1] !== '\n';
    const prefixo = precisaQuebra ? '\n' : '';
    const novo = v.slice(0, start) + prefixo + bloco.tpl + v.slice(end);
    onChange(novo);
    caretPend.current = start + prefixo.length + bloco.tpl.length;
    setMenu(null);
  }

  // colar conteúdo formatado (Word, Google Docs, Notion, web) vira markdown
  function aoColar(e) {
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html) return; // sem HTML: deixa o paste padrão de texto puro
    let md = '';
    try { md = htmlParaMarkdown(html); } catch { md = ''; }
    if (!md || !md.trim()) return; // fallback: paste padrão
    e.preventDefault();
    const ta = ref.current; const v = value || '';
    const s = ta ? ta.selectionStart : v.length;
    const end = ta ? ta.selectionEnd : s;
    const novo = v.slice(0, s) + md + v.slice(end);
    onChange(novo);
    caretPend.current = s + md.length;
    setMenu(null);
  }

  // continua listas ao apertar Enter
  function aoTecla(e) {
    if (menu && opcoes.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % opcoes.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + opcoes.length) % opcoes.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); inserir(opcoes[sel]); return; }
      if (e.key === 'Escape') { setMenu(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const ta = e.target; const caret = ta.selectionStart;
      const v = value || '';
      const ini = v.lastIndexOf('\n', caret - 1) + 1;
      const linha = v.slice(ini, caret);
      let mm;
      let prefixo = null; let vazio = false;
      if ((mm = linha.match(/^(\s*)- \[[ xX]\] (.*)$/))) { prefixo = `${mm[1]}- [ ] `; vazio = !mm[2].trim(); }
      else if ((mm = linha.match(/^(\s*)[-*] (.*)$/))) { prefixo = `${mm[1]}- `; vazio = !mm[2].trim(); }
      else if ((mm = linha.match(/^(\s*)(\d+)[.)] (.*)$/))) { prefixo = `${mm[1]}${Number(mm[2]) + 1}. `; vazio = !mm[3].trim(); }
      if (prefixo != null) {
        e.preventDefault();
        if (vazio) { // item vazio: sai da lista (remove o prefixo da linha atual)
          const novo = v.slice(0, ini) + v.slice(caret);
          onChange(novo); caretPend.current = ini;
        } else {
          const novo = v.slice(0, caret) + '\n' + prefixo + v.slice(caret);
          onChange(novo); caretPend.current = caret + 1 + prefixo.length;
        }
      }
    }
  }

  return (
    <div className="editor-desc">
      <div style={{ position: 'relative' }}>
        <textarea ref={ref} value={value} onChange={aoDigitar} onKeyDown={aoTecla} onPaste={aoColar}
          onBlur={() => setTimeout(() => setMenu(null), 150)}
          placeholder={placeholder || 'Escreva a demanda… digite / para inserir listas, tabela, checklist… ou cole texto formatado.'} />
        {menu && opcoes.length > 0 && (
          <div className="slash-menu">
            <div className="slash-titulo">Inserir bloco</div>
            {opcoes.map((b, idx) => (
              <button type="button" key={b.key} className={`slash-item ${idx === sel ? 'on' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); inserir(b); }}>
                <span className="slash-ico">{b.ico}</span>
                <span><b>{b.label}</b><small>{b.desc}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
