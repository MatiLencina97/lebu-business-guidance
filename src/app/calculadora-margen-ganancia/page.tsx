"use client";

import { useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default function MargenGananciaPage() {
  const [costo, setCosto] = useState(2000);
  const [precio, setPrecio] = useState(6000);
  const r = useMemo(() => {
    const ganancia = precio - costo;
    return {
      ganancia,
      margen: precio > 0 ? (ganancia / precio) * 100 : 0,
      markup: costo > 0 ? (ganancia / costo) * 100 : 0,
    };
  }, [costo, precio]);

  return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",fontFamily:"system-ui"}}>
    <p style={{fontWeight:700}}>LEBU · herramienta gratuita</p>
    <h1>Calculadora de margen de ganancia</h1>
    <p>Calculá cuánto te deja una venta y diferenciá margen sobre venta de recargo sobre costo.</p>
    <section style={{display:"grid",gap:16,marginTop:32}}>
      <label>Costo del producto ($)<input aria-label="Costo" type="number" min="0" value={costo} onChange={e=>setCosto(Number(e.target.value))} style={{display:"block",width:"100%",padding:12,marginTop:6}} /></label>
      <label>Precio de venta ($)<input aria-label="Precio de venta" type="number" min="0" value={precio} onChange={e=>setPrecio(Number(e.target.value))} style={{display:"block",width:"100%",padding:12,marginTop:6}} /></label>
    </section>
    <section style={{marginTop:32,padding:24,border:"1px solid currentColor",borderRadius:16}}>
      <p>Ganancia bruta por unidad</p><h2>{money.format(r.ganancia)}</h2>
      <p>Margen sobre precio de venta</p><h2>{r.margen.toFixed(1)}%</h2>
      <p>Recargo (markup) sobre costo: <strong>{r.markup.toFixed(1)}%</strong></p>
      {r.ganancia < 0 && <p><strong>Atención:</strong> con estos valores vendés por debajo del costo.</p>}
    </section>
    <section style={{marginTop:32}}>
      <h2>Margen y markup no son lo mismo</h2>
      <p>El margen compara la ganancia con el precio final. El markup compara esa misma ganancia con el costo. Por eso un recargo del 100% sobre costo equivale a un margen del 50% sobre venta.</p>
      <h2>¿Cómo usar este dato?</h2>
      <p>Conocer el margen ayuda a estimar cuánto de cada venta queda disponible para cubrir costos fijos y generar resultado. Para saber cuánto necesitás vender para no perder plata, usá también el punto de equilibrio.</p>
      <a href="/" style={{fontWeight:700}}>Conocé Lebu →</a><span> · </span><a href="/calculadora-punto-de-equilibrio">Calculá tu punto de equilibrio →</a>
    </section>
    <p style={{marginTop:40,fontSize:13,opacity:.7}}>Resultado orientativo. No reemplaza asesoramiento contable o financiero.</p>
  </main>;
}
