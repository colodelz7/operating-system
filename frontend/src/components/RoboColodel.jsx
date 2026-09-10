/* Mascote do ColodelBot: fica sentado em cima da janela do chat.

   Três estados, todos só com CSS (nada de biblioteca de animação):
     ocioso   -> flutua de leve, pisca de vez em quando, antena pulsando
     pensando -> olhos viram reticências e a antena gira mais rápido
     feliz    -> dá um pulinho e sorri, logo depois de uma ação dar certo

   Quem tem "movimento reduzido" ligado no sistema vê o robô parado: as
   animações caem pela regra global de prefers-reduced-motion. */

export default function RoboColodel({ estado = 'ocioso' }) {
  return (
    <div className={`robo robo--${estado}`} aria-hidden="true">
      <svg viewBox="0 0 72 64" width="72" height="64">
        {/* antena */}
        <line className="robo__haste" x1="36" y1="14" x2="36" y2="6" />
        <circle className="robo__luz" cx="36" cy="5" r="3.4" />

        {/* orelhas */}
        <rect className="robo__orelha" x="4" y="30" width="7" height="14" rx="3.5" />
        <rect className="robo__orelha" x="61" y="30" width="7" height="14" rx="3.5" />

        {/* cabeça */}
        <rect className="robo__cabeca" x="12" y="14" width="48" height="38" rx="13" />

        {/* visor */}
        <rect className="robo__visor" x="18" y="21" width="36" height="24" rx="10" />

        {/* olhos: dois pontos que piscam */}
        <g className="robo__olhos">
          <circle cx="28.5" cy="32" r="3.6" />
          <circle cx="43.5" cy="32" r="3.6" />
        </g>

        {/* reticências de "pensando" (só aparecem nesse estado) */}
        <g className="robo__pensa">
          <circle cx="27" cy="33" r="2.3" />
          <circle cx="36" cy="33" r="2.3" />
          <circle cx="45" cy="33" r="2.3" />
        </g>

        {/* sorriso do estado feliz */}
        <path className="robo__sorriso" d="M29 38.5c2.2 2.4 5.4 2.4 7.6 0" />
      </svg>
    </div>
  );
}
