import { useState } from 'react';
import { GCAL_KEY, GCAL_DEFAULT } from '../lib/constants';
import { validarUrlCalendario, MSG_URL_INVALIDA } from '../lib/calendario';

// So entra no iframe endereco https de calendario conhecido. O que estiver
// salvo de antes tambem passa pela validacao (nunca confiamos no que ja
// estava no localStorage).
function lerSalvo() {
  const bruto = localStorage.getItem(GCAL_KEY) || GCAL_DEFAULT;
  return validarUrlCalendario(bruto);
}

export default function CalendarioEquipe() {
  const [url, setUrl] = useState(lerSalvo);
  const [erro, setErro] = useState('');

  const trocar = () => {
    const v = prompt('Cole o endereço (src) do "Incorporar" do Google Calendar:', url || '');
    if (v === null) return;
    const val = v.trim();

    // vazio = limpar o calendario configurado
    if (!val) {
      localStorage.removeItem(GCAL_KEY);
      setUrl(validarUrlCalendario(GCAL_DEFAULT));
      setErro('');
      return;
    }

    const valida = validarUrlCalendario(val);
    if (!valida) { setErro(MSG_URL_INVALIDA); return; }

    localStorage.setItem(GCAL_KEY, valida);
    setUrl(valida);
    setErro('');
  };

  return (
    <>
      <div className="cal-equipe-topo">
        <div><b>Calendário da Equipe</b></div>
        <button className="btn btn-ghost btn-sm" onClick={trocar}>Trocar calendário</button>
      </div>

      {erro && <div className="form-erro" style={{ display: 'block' }} role="alert">{erro}</div>}

      {url ? (
        <div className="cal-equipe-embed">
          <iframe
            title="Calendário da Equipe" src={url} style={{ border: 0 }}
            width="100%" height="640" frameBorder="0" scrolling="no"
            sandbox="allow-scripts allow-same-origin allow-popups"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="vazio">
          <b>Nenhum calendário configurado</b>
          Clique em "Trocar calendário" e cole o endereço de "Incorporar" do calendário da equipe.
        </div>
      )}
    </>
  );
}
