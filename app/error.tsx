"use client";
export default function GlobalError({ reset }: { reset: () => void }) { return <main className="center-state"><h1>Algo não saiu como esperado</h1><p>Seus dados continuam salvos. Tente carregar novamente.</p><button className="button primary" onClick={reset}>Tentar novamente</button></main>; }
