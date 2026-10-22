"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const inputStyle = {display:"block",width:"100%",padding:12,marginTop:6,border:"1px solid #9ca3af",borderRadius:10,background:"#ffffff",color:"#111827",boxShadow:"0 1px 2px rgba(0,0,0,.06)"};

export default function PagarEmpleadoPage() {
  const [costoEmpleado, setCostoEmpleado] = useState(1200000);
  const [otrosFijos, setOtrosFijos] = useState(5000000);
  const [margen, setMargen] = useState(60);
  const [dias, setDias] = useState(26);

  const r = useMemo(() => {
    const m = Math.min(100, Math.max(1, margen)) / 100;
    const costo = Math.max(0, costoEmpleado);
    const fijos = Math.max(0, otrosFijos);
    const abiertos = Math.max(1, dias);
    const ventasEmpleado = costo / m;
    const ventasTotales = (costo + fijos) / m;
    return {
      ventasEmpleado,
      ventasEmpleadoDia: ventasEmpleado / abiertos,
      ventasTotales,
      ventasTotalesDia: ventasTotales / abiertos,
    };
  }, [costoEmpleado, otrosFijos, margen, dias]);

  return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",fontFamily:"system-ui"}}>
    <p style={{fontWeight:700}}>LEBU · herramienta gratuita</p>
    <h1>¿Cuánto tengo que vender para pagar un empleado?</h1>
    <p>Estimá cuánta facturación adicional necesita generar tu negocio para absorber el costo mensual de una persona sin perder margen.</p>

    <section style={{display:"grid",gap:16,marginTop:32}}>
      <label>Costo mensual total del empleado ($)
        <input aria-label="Costo mensual total del empleado" type="number" min="0" value={costoEmpleado} onChange={e=>setCostoEmpleado(Number(e.target.value))} style={inputStyle}/>
      </label>
      <label>Otros costos fijos mensuales ($)
        <input aria-label="Otros costos fijos" type="number" min="0" value={otrosFijos} onChange={e=>setOtrosFijos(Number(e.target.value))} style={inputStyle}/>
      </label>
      <label>Margen bruto promedio del negocio (%)
        <input aria-label="Margen bruto promedio" type="number" min="1" max="100" step="0.1" value={margen} onChange={e=>setMargen(Number(e.target.value))} style={inputStyle}/>
      </label>
      <label>Días abiertos por mes
        <input aria-label="Días abiertos por mes" type="number" min="1" max="31" value={dias} onChange={e=>setDias(Number(e.target.value))} style={inputStyle}/>
      </label>
    </section>

    <section style={{marginTop:32,padding:24,border:"1px solid currentColor",borderRadius:16}}>
      <p>Facturación mensual adicional para cubrir al empleado</p>
      <h2>{money.format(r.ventasEmpleado)}</h2>
      <p>Equivale a aproximadamente <strong>{money.format(r.ventasEmpleadoDia)} por día</strong>.</p>
      <hr style={{margin:"20px 0",opacity:.25}}/>
      <p>Facturación mensual estimada para cubrir empleado + otros costos fijos</p>
      <h2>{money.format(r.ventasTotales)}</h2>
      <p>Objetivo diario aproximado: <strong>{money.format(r.ventasTotalesDia)}</strong>.</p>
    </section>

    <section style={{marginTop:32}}>
      <h2>Por qué no alcanza con vender lo mismo que cuesta el sueldo</h2>
      <p>Si tu negocio tiene costos variables, cada peso vendido no queda disponible para pagar estructura. Por eso esta calculadora divide el costo por tu margen bruto: cuanto menor es tu margen, más facturación necesitás para cubrir el mismo costo.</p>

      <h2>Qué valor poner como costo del empleado</h2>
      <p>Usá el costo mensual total que realmente querés absorber en el negocio. Si necesitás calcular cargas, ART, aguinaldo u otros conceptos laborales, obtené primero ese total con tu contador o una calculadora laboral actualizada y cargalo acá.</p>

      <h2>Del cálculo al seguimiento diario</h2>
      <p>Lebu transforma estos compromisos en objetivos diarios y los compara contra tus ventas y gastos reales para mostrar si el negocio viene al ritmo necesario.</p>

      <Link href="/" style={{fontWeight:700}}>Conocé Lebu →</Link><span> · </span>
      <Link href="/calculadora-cuanto-vender-por-dia">Calculá cuánto vender por día →</Link>
    </section>

    <p style={{marginTop:40,fontSize:13,opacity:.7}}>Estimación de gestión. No calcula obligaciones laborales ni reemplaza asesoramiento contable, laboral o impositivo.</p>
  </main>;
}
