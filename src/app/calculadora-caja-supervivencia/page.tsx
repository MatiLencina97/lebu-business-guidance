"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

const money=new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0});
const inputStyle={display:"block",width:"100%",padding:12,marginTop:6,border:"1px solid #9ca3af",borderRadius:10,background:"#fff",color:"#111827",boxShadow:"0 1px 2px rgba(0,0,0,.06)"};

export default function CajaSupervivenciaPage(){
 const [caja,setCaja]=useState(2000000);
 const [ingresos,setIngresos]=useState(5000000);
 const [egresos,setEgresos]=useState(6000000);
 const [cobros,setCobros]=useState(0);
 const r=useMemo(()=>{
  const quema=Math.max(0,egresos-ingresos);
  const cajaDisponible=Math.max(0,caja+cobros);
  const meses=quema>0?cajaDisponible/quema:null;
  const equilibrio=Math.max(0,egresos-ingresos);
  return {quema,cajaDisponible,meses,equilibrio};
 },[caja,ingresos,egresos,cobros]);
 return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",fontFamily:"system-ui"}}>
  <p style={{fontWeight:700}}>LEBU · herramienta gratuita</p>
  <h1>Calculadora de caja: ¿cuántos meses aguanta mi negocio?</h1>
  <p>Estimá tu runway de caja con el efectivo disponible y el déficit mensual actual. Sirve para detectar cuánto tiempo tenés para alcanzar el equilibrio antes de quedarte sin caja.</p>
  <section style={{display:"grid",gap:16,marginTop:32}}>
   <label>Caja disponible hoy ($)<input aria-label="Caja disponible" type="number" min="0" value={caja} onChange={e=>setCaja(Number(e.target.value))} style={inputStyle}/></label>
   <label>Ingresos mensuales promedio ($)<input aria-label="Ingresos mensuales" type="number" min="0" value={ingresos} onChange={e=>setIngresos(Number(e.target.value))} style={inputStyle}/></label>
   <label>Egresos mensuales promedio ($)<input aria-label="Egresos mensuales" type="number" min="0" value={egresos} onChange={e=>setEgresos(Number(e.target.value))} style={inputStyle}/></label>
   <label>Cobros confirmados próximos ($)<input aria-label="Cobros confirmados" type="number" min="0" value={cobros} onChange={e=>setCobros(Number(e.target.value))} style={inputStyle}/></label>
  </section>
  <section style={{marginTop:32,padding:24,border:"1px solid currentColor",borderRadius:16}}>
   {r.quema>0 ? <>
    <p>Déficit / quema mensual: <strong>{money.format(r.quema)}</strong></p>
    <p>Caja considerada: <strong>{money.format(r.cajaDisponible)}</strong></p>
    <p>Runway estimado</p><h2>{r.meses?.toFixed(1)} meses</h2>
    <p>Para dejar de consumir caja necesitás mejorar el resultado mensual en al menos <strong>{money.format(r.equilibrio)}</strong>, combinando más margen, ventas o menos egresos.</p>
   </> : <>
    <h2>No estás consumiendo caja con estos promedios</h2>
    <p>Los ingresos mensuales alcanzan para cubrir los egresos ingresados. Conservá un colchón para estacionalidad e imprevistos.</p>
   </>}
  </section>
  <section style={{marginTop:32}}>
   <h2>¿Qué significa runway?</h2>
   <p>Es una estimación de cuántos meses puede sostenerse el negocio si mantiene el déficit actual. No es una proyección contable: ayuda a priorizar decisiones de caja.</p>
   <h2>No cuentes ventas futuras como caja</h2>
   <p>Incluí en “cobros confirmados” solo dinero con alta certeza de ingreso. Una venta esperada, una propuesta o tráfico web no son efectivo disponible.</p>
   <h2>Qué hacer si el runway es corto</h2>
   <p>Probá escenarios reduciendo egresos o aumentando ingresos. Compará cuánto cambia el tiempo disponible y cuánto falta para llegar al equilibrio.</p>
   <Link href="/calculadora-punto-de-equilibrio" style={{fontWeight:700}}>Calculá tu punto de equilibrio →</Link><span> · </span><Link href="/" style={{fontWeight:700}}>Conocé Lebu →</Link>
  </section>
  <p style={{marginTop:40,fontSize:13,opacity:.7}}>Estimación de gestión. No reemplaza asesoramiento contable o financiero.</p>
 </main>;
}
