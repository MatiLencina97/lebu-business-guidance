"use client";

import { useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default function CalculadoraVentasPage() {
  const [gastos, setGastos] = useState(2500000);
  const [ganancia, setGanancia] = useState(800000);
  const [margen, setMargen] = useState(65);
  const [dias, setDias] = useState(26);

  const r = useMemo(() => {
    const m = Math.min(100, Math.max(1, margen)) / 100;
    const mensual = (Math.max(0, gastos) + Math.max(0, ganancia)) / m;
    return { mensual, diario: mensual / Math.max(1, dias) };
  }, [gastos, ganancia, margen, dias]);

  return (
    <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",fontFamily:"system-ui"}}>
      <p style={{fontWeight:700}}>LEBU · herramienta gratuita</p>
      <h1>¿Cuánto tenés que vender por día?</h1>
      <p>Calculá en menos de un minuto cuánto necesita facturar tu negocio para cubrir gastos y alcanzar tu objetivo de ganancia.</p>
      <section style={{display:"grid",gap:16,marginTop:32}}>
        <label>Gastos mensuales ($)<input aria-label="Gastos mensuales" type="number" min="0" value={gastos} onChange={e=>setGastos(Number(e.target.value))} style={{display:"block",width:"100%",padding:12,marginTop:6}} /></label>
        <label>Ganancia mensual que querés ($)<input aria-label="Ganancia objetivo" type="number" min="0" value={ganancia} onChange={e=>setGanancia(Number(e.target.value))} style={{display:"block",width:"100%",padding:12,marginTop:6}} /></label>
        <label>Margen bruto estimado (%)<input aria-label="Margen bruto" type="number" min="1" max="100" value={margen} onChange={e=>setMargen(Number(e.target.value))} style={{display:"block",width:"100%",padding:12,marginTop:6}} /></label>
        <label>Días abiertos por mes<input aria-label="Días abiertos" type="number" min="1" max="31" value={dias} onChange={e=>setDias(Number(e.target.value))} style={{display:"block",width:"100%",padding:12,marginTop:6}} /></label>
      </section>
      <section style={{marginTop:32,padding:24,border:"1px solid currentColor",borderRadius:16}}>
        <p>Objetivo de facturación mensual</p><h2>{money.format(r.mensual)}</h2>
        <p>Necesitás vender aproximadamente</p><h2>{money.format(r.diario)} por día</h2>
      </section>
      <section style={{marginTop:32}}>
        <h2>¿Por qué no alcanza con dividir gastos por días?</h2>
        <p>Porque las ventas también tienen costos variables. Esta calculadora ajusta el objetivo usando tu margen bruto: cuanto menor sea el margen, más facturación necesitás para cubrir los mismos gastos y obtener la misma ganancia.</p>
        <h2>De la cuenta al seguimiento diario</h2>
        <p>Lebu convierte tu objetivo mensual en una meta diaria y permite seguir ventas, gastos y progreso durante el período. Así podés saber si hoy estás por encima o por debajo del ritmo necesario.</p>
        <a href="/" style={{display:"inline-block",marginTop:8,fontWeight:700}}>Conocé Lebu →</a>
      </section>
      <p style={{marginTop:40,fontSize:13,opacity:.7}}>Resultado orientativo. No reemplaza asesoramiento contable o financiero.</p>
    </main>
  );
}
