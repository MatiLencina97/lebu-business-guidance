"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const inputStyle = {display:"block",width:"100%",padding:12,marginTop:6,border:"1px solid #9ca3af",borderRadius:10,background:"#ffffff",color:"#111827",boxShadow:"0 1px 2px rgba(0,0,0,.06)"};

export default function PrecioVentaPage() {
  const [costo, setCosto] = useState(2500);
  const [margen, setMargen] = useState(40);
  const [comision, setComision] = useState(0);
  const r = useMemo(() => {
    const c = Math.max(0, costo);
    const m = Math.min(99, Math.max(0, margen)) / 100;
    const fee = Math.min(99, Math.max(0, comision)) / 100;
    const availableShare = 1 - m - fee;
    if (availableShare <= 0) return null;
    const precio = c / availableShare;
    return { precio, ganancia: precio * m, comisionPesos: precio * fee };
  }, [costo, margen, comision]);

  return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",fontFamily:"system-ui"}}>
    <p style={{fontWeight:700}}>LEBU · herramienta gratuita</p>
    <h1>Calculadora de precio de venta</h1>
    <p>Calculá a qué precio vender un producto para alcanzar el margen que buscás, incluyendo comisiones sobre la venta.</p>
    <section style={{display:"grid",gap:16,marginTop:32}}>
      <label>Costo total por unidad ($)<input aria-label="Costo total por unidad" type="number" min="0" value={costo} onChange={e=>setCosto(Number(e.target.value))} style={inputStyle} /></label>
      <label>Margen deseado (%)<input aria-label="Margen deseado" type="number" min="0" max="99" value={margen} onChange={e=>setMargen(Number(e.target.value))} style={inputStyle} /></label>
      <label>Comisión sobre la venta (%)<input aria-label="Comisión sobre la venta" type="number" min="0" max="99" value={comision} onChange={e=>setComision(Number(e.target.value))} style={inputStyle} /></label>
    </section>
    <section style={{marginTop:32,padding:24,border:"1px solid currentColor",borderRadius:16}}>
      {r ? <>
        <p>Precio de venta sugerido</p><h2>{money.format(r.precio)}</h2>
        <p>Ganancia objetivo por unidad: <strong>{money.format(r.ganancia)}</strong></p>
        <p>Comisión estimada: <strong>{money.format(r.comisionPesos)}</strong></p>
      </> : <>
        <p><strong>No existe un precio válido con estos porcentajes.</strong></p>
        <p>El margen deseado más la comisión deben sumar menos de 100%. Bajá alguno de los dos valores para poder calcular un precio sostenible.</p>
      </>}
    </section>
    <section style={{marginTop:32}}>
      <h2>¿Por qué no alcanza con sumar un porcentaje al costo?</h2>
      <p>Sumar 40% al costo no produce un margen de 40%. El margen se calcula sobre el precio final. Esta calculadora despeja el precio necesario para conservar el porcentaje buscado después del costo y las comisiones.</p>
      <h2>Incluí el costo real</h2>
      <p>Usá el costo completo de la unidad: materia prima o compra, packaging y otros costos variables que correspondan. Si una plataforma o medio de pago cobra un porcentaje, agregalo como comisión.</p>
      <h2>Convertí el precio en un objetivo de ventas</h2>
      <p>Lebu te ayuda a conectar precios, gastos y objetivos para saber cuánto necesitás vender durante el período y si venís al ritmo necesario.</p>
      <Link href="/" style={{fontWeight:700}}>Conocé Lebu →</Link><span> · </span><Link href="/calculadora-margen-ganancia">Calculá tu margen actual →</Link>
    </section>
    <p style={{marginTop:40,fontSize:13,opacity:.7}}>Resultado orientativo. No reemplaza asesoramiento contable o financiero.</p>
  </main>;
}
