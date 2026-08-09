import { useState } from 'react';
import { GCAL_KEY, GCAL_DEFAULT } from '../lib/constants';

export default function CalendarioEquipe() {
  const [url, setUrl] = useState(() => localStorage.getItem(GCAL_KEY) || GCAL_DEFAULT);

  const trocar = () => {
    const v = prompt('Cole o endereço (src) do "Incorporar" do Google Calendar:', url || '');
    if (v === null) return;
    const val = v.trim();
    if (val) { localStorage.setItem(GCAL_KEY, val); setUrl(val); }
    else { localStorage.removeItem(GCAL_KEY); setUrl(GCAL_DEFAULT); }
  };

  return (
    <>
      <div className="cal-equipe-topo">
        <div><b>Calendário da Equipe</b></div>
        <button className="btn btn-ghost btn-sm" onClick={trocar}>Trocar calendário</button>
      </div>
      <div className="cal-equipe-embed">
        <iframe title="Calendário da Equipe" src={url} style={{ border: 0 }} width="100%" height="640" frameBorder="0" scrolling="no" />
      </div>
    </>
  );
}
