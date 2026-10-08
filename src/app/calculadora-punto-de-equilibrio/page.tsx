"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const inputStyle = {display:"block",width:"100%",padding:12,marginTop:6,border:"1px solid #9ca3af",borderRadius:10,background:"#ffffff",color:"#111827",boxShadow:"0 1px 2px rgba(0,0,0,.06)"};

export default function PuntoEquilibrioPage() {
  const [fijos, setFijos] = useState(7000000);
  const [precio, setPrecio] = useState(6000);
  const [variable, setVariable] = useState(2000);
  const [dias, setDias] = useState(26);
  const r = useMemo(() => {
    const contribucion = precio - variable;
    if (contribucion <= 0) return null;
    const unidades = Math.ceil(Math.max(0, fijos) / contribucion);
    const ventas = unidades * precio;
    return { contribucion, margen: precio > 0 ? (contribucion / precio) * 100 : 0, unidades, ventas, diario: ventas / Math.max(1, dias) };
  }, [fijos, precio, variable, dias]);

  return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",fontFamily:"system-ui"}}>
    <p style={{fontWeight:700}}>LEBU · herramienta gratuita</p>
    <h1>Calculadora de punto de equilibrio</h1>
    <p>Descubrí cuánto necesita vender tu negocio para cubrir sus costos sin perder plata.</p>
    <section style={{display:"grid",gap:16,marginTop:32}}>
      <label>Costos fijos mensuales ($)<input aria-label="Costos fijos" type="number" min="0" value={fijos} onChange={e=>setFijos(Number(e.target.value))} style={inputStyle} /></label>
      <label>Precio de venta promedio ($)<input aria-label="Precio de venta" type="number" min="0" value={precio} onChange={e=>setPrecio(Number(e.target.value))} style={inputStyle} /></label>
      <label>Costo variable por venta ($)<input aria-label="Costo variable" type="number" min="0" value={variable} onChange={e=>setVariable(Number(e.target.value))} style={inputStyle} /></label>
      <label>Días abiertos por mes<input aria-label="Días abiertos" type="number" min="1" max="31" value={dias} onChange={e=>setDias(Number(e.target.value))} style={inputStyle} /></label>
    </section>
    <section style={{marginTop:32,padding:24,border:"1px solid currentColor",borderRadius:16}}>
      {r ? <><p>Margen de contribución: <strong>{money.format(r.contribucion)} ({r.margen.toFixed(1)}%)</strong></p><p>Unidades para cubrir costos</p><h2>{r.unidades.toLocaleString("es-AR")}</h2><p>Facturación mensual de equilibrio</p><h2>{money.format(r.ventas)}</h2><p>Equivale aproximadamente a <strong>{money.format(r.diario)} por día</strong>.</p></> : <p><strong>No existe punto de equilibrio con estos valores.</strong> El precio debe ser mayor que el costo variable.</p>}
    </section>
    <section style={{marginTop:32}}>
      <h2>¿Qué es el punto de equilibrio?</h2><p>Es el nivel de ventas en el que el margen que deja cada venta alcanza exactamente para cubrir los costos fijos. Por debajo perdés dinero; por encima empezás a generar resultado positivo.</p>
      <h2>¿Cómo se calcula?</h2><p>Unidades de equilibrio = costos fijos ÷ (precio de venta − costo variable por unidad). Si tenés muchos productos, podés usar un ticket y costo variable promedio como aproximación.</p>
      <h2>Del cálculo al seguimiento diario</h2><p>Lebu lleva esta lógica al día a día: combina objetivos, ventas, gastos y compromisos para mostrar si tu negocio viene al ritmo necesario.</p>
      <Link href="/" style={{fontWeight:700}}>Conocé Lebu →</Link><span> · </span><Link href="/calculadora-cuanto-vender-por-dia">Calculá cuánto vender por día →</Link>
    </section>
    <p style={{marginTop:40,fontSize:13,opacity:.7}}>Resultado orientativo. No reemplaza asesoramiento contable o financiero.</p>
  </main>;
}
