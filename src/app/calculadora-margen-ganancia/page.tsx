"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const inputStyle = {display:"block",width:"100%",padding:12,marginTop:6,border:"1px solid #9ca3af",borderRadius:10,background:"#ffffff",color:"#111827",boxShadow:"0 1px 2px rgba(0,0,0,.06)"};

export default function MargenGananciaPage() {
  const [costo, setCosto] = useState(2000);
  const [precio, setPrecio] = useState(6000);
  const [fijos, setFijos] = useState(0);
  const [unidades, setUnidades] = useState(1);
  const r = useMemo(() => {
    const cantidad = Math.max(1, unidades);
    const ventaTotal = Math.max(0, precio) * cantidad;
    const costoTotal = Math.max(0, costo) * cantidad + Math.max(0, fijos);
    const ganancia = ventaTotal - costoTotal;
    return {
      ventaTotal, costoTotal, ganancia,
      margen: ventaTotal > 0 ? ganancia / ventaTotal * 100 : 0,
      markup: costoTotal > 0 ? ganancia / costoTotal * 100 : 0,
    };
  }, [costo, precio, fijos, unidades]);

  return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",fontFamily:"system-ui"}}>
    <p style={{fontWeight:700}}>LEBU · herramienta gratuita</p>
    <h1>Calculadora de margen de ganancia</h1>
    <p>Calculá cuánto te deja realmente un producto y qué porcentaje de tus ventas queda como ganancia.</p>
    <section style={{display:"grid",gap:16,marginTop:32}}>
      <label>Costo por unidad ($)<input aria-label="Costo por unidad" type="number" min="0" value={costo} onChange={e=>setCosto(Number(e.target.value))} style={inputStyle} /></label>
      <label>Precio de venta ($)<input aria-label="Precio de venta" type="number" min="0" value={precio} onChange={e=>setPrecio(Number(e.target.value))} style={inputStyle} /></label>
      <label>Unidades vendidas<input aria-label="Unidades" type="number" min="1" value={unidades} onChange={e=>setUnidades(Number(e.target.value))} style={inputStyle} /></label>
      <label>Otros costos del período ($)<input aria-label="Otros costos" type="number" min="0" value={fijos} onChange={e=>setFijos(Number(e.target.value))} style={inputStyle} /></label>
    </section>
    <section style={{marginTop:32,padding:24,border:"1px solid currentColor",borderRadius:16}}>
      <p>Facturación: <strong>{money.format(r.ventaTotal)}</strong></p>
      <p>Costos considerados: <strong>{money.format(r.costoTotal)}</strong></p>
      <p>Ganancia estimada</p><h2>{money.format(r.ganancia)}</h2>
      <p>Margen sobre ventas: <strong>{r.margen.toFixed(1)}%</strong> · Markup sobre costos: <strong>{r.markup.toFixed(1)}%</strong></p>
    </section>
    <section style={{marginTop:32}}>
      <h2>Margen y markup no son lo mismo</h2>
      <p>El margen compara la ganancia con el precio de venta. El markup compara la ganancia con el costo. Por eso un producto que cuesta $2.000 y se vende a $4.000 tiene 100% de markup, pero 50% de margen.</p>
      <h2>¿Qué costos conviene incluir?</h2>
      <p>Para analizar un producto, empezá por su costo directo. Para aproximarte al resultado real del negocio, agregá comisiones, packaging y otros costos atribuibles al período.</p>
      <h2>Del margen al objetivo diario</h2>
      <p>Lebu usa tus ventas, gastos y objetivos para mostrar cuánto necesitás vender y si venís al ritmo necesario durante el período.</p>
      <Link href="/" style={{fontWeight:700}}>Conocé Lebu →</Link><span> · </span><Link href="/calculadora-punto-de-equilibrio">Calculá tu punto de equilibrio →</Link>
    </section>
    <p style={{marginTop:40,fontSize:13,opacity:.7}}>Resultado orientativo. No reemplaza asesoramiento contable o financiero.</p>
  </main>;
}
