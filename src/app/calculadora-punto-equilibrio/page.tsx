"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0});
const inputStyle={display:"block",width:"100%",padding:12,marginTop:6,border:"1px solid #9ca3af",borderRadius:10,background:"#fff",color:"#111827",boxShadow:"0 1px 2px rgba(0,0,0,.06)"};

export default function PuntoEquilibrioPage(){
 const [fijos,setFijos]=useState(3000000);
 const [precio,setPrecio]=useState(10000);
 const [variable,setVariable]=useState(4000);
 const [dias,setDias]=useState(26);
 const r=useMemo(()=>{
  const contrib=Math.max(0,precio-variable);
  const margen=precio>0?contrib/precio:0;
  const unidades=contrib>0?Math.ceil(Math.max(0,fijos)/contrib):null;
  const ventas=margen>0?Math.max(0,fijos)/margen:null;
  return {contrib,margen,unidades,ventas,ventasDia:ventas!==null?ventas/Math.max(1,dias):null};
 },[fijos,precio,variable,dias]);
 return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",fontFamily:"system-ui"}}>
  <p style={{fontWeight:700}}>LEBU · herramienta gratuita</p>
  <h1>Calculadora de punto de equilibrio</h1>
  <p>Calculá cuánto necesitás vender para cubrir costos fijos y variables antes de empezar a generar ganancia.</p>
  <section style={{display:"grid",gap:16,marginTop:32}}>
   <label>Costos fijos mensuales ($)<input aria-label="Costos fijos mensuales" type="number" min="0" value={fijos} onChange={e=>setFijos(Number(e.target.value))} style={inputStyle}/></label>
   <label>Precio promedio por unidad o venta ($)<input aria-label="Precio promedio" type="number" min="0" value={precio} onChange={e=>setPrecio(Number(e.target.value))} style={inputStyle}/></label>
   <label>Costo variable promedio por unidad o venta ($)<input aria-label="Costo variable promedio" type="number" min="0" value={variable} onChange={e=>setVariable(Number(e.target.value))} style={inputStyle}/></label>
   <label>Días abiertos por mes<input aria-label="Días abiertos" type="number" min="1" max="31" value={dias} onChange={e=>setDias(Number(e.target.value))} style={inputStyle}/></label>
  </section>
  <section style={{marginTop:32,padding:24,border:"1px solid currentColor",borderRadius:16}}>
   <p>Margen de contribución por venta: <strong>{money.format(r.contrib)}</strong> ({(r.margen*100).toFixed(1)}%)</p>
   {r.ventas!==null && r.unidades!==null ? <>
    <p>Facturación mensual de equilibrio</p><h2>{money.format(r.ventas)}</h2>
    <p>Equivale a unas <strong>{r.unidades.toLocaleString("es-AR")} ventas/unidades</strong> al mes.</p>
    <p>Objetivo diario aproximado: <strong>{money.format(r.ventasDia ?? 0)}</strong>.</p>
   </>:<p><strong>No hay punto de equilibrio con estos valores:</strong> el precio debe ser mayor que el costo variable.</p>}
  </section>
  <section style={{marginTop:32}}>
   <h2>¿Qué es el punto de equilibrio?</h2>
   <p>Es el nivel de ventas en el que el margen de contribución alcanza exactamente para pagar los costos fijos. Por debajo hay pérdida operativa; por encima empieza a quedar resultado.</p>
   <h2>¿Cómo se calcula?</h2>
   <p>Margen de contribución = precio − costo variable. Punto de equilibrio en ventas = costos fijos ÷ porcentaje de margen de contribución.</p>
   <h2>Usalo con promedios reales</h2>
   <p>Si vendés muchos productos distintos, usá un ticket promedio y un costo variable promedio representativos. Para decisiones importantes, separá líneas de producto y compará escenarios.</p>
   <Link href="/" style={{fontWeight:700}}>Conocé Lebu →</Link><span> · </span><Link href="/calculadora-cuanto-vender-por-dia">Calculá cuánto vender por día →</Link>
  </section>
  <p style={{marginTop:40,fontSize:13,opacity:.7}}>Estimación de gestión. No reemplaza asesoramiento contable o financiero.</p>
 </main>;
}
