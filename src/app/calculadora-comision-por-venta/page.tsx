"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const inputStyle = {display:"block",width:"100%",padding:12,marginTop:6,border:"1px solid #9ca3af",borderRadius:10,background:"#ffffff",color:"#111827",boxShadow:"0 1px 2px rgba(0,0,0,.06)"};

export default function ComisionesVentaPage() {
  const [venta, setVenta] = useState(10000);
  const [comision, setComision] = useState(30);
  const [fijo, setFijo] = useState(0);
  const [costo, setCosto] = useState(3000);

  const r = useMemo(() => {
    const fee = Math.max(0, venta) * Math.max(0, comision) / 100 + Math.max(0, fijo);
    const neto = venta - fee;
    const ganancia = neto - Math.max(0, costo);
    const margen = venta > 0 ? ganancia / venta * 100 : 0;
    const precioParaNeto = comision < 100 ? (Math.max(0, costo) + Math.max(0, fijo)) / (1 - Math.max(0, comision) / 100) : null;
    return { fee, neto, ganancia, margen, precioParaNeto };
  }, [venta, comision, fijo, costo]);

  return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",fontFamily:"system-ui"}}>
    <p style={{fontWeight:700}}>LEBU · herramienta gratuita</p>
    <h1>Calculadora de comisión por venta</h1>
    <p>Calculá cuánto te queda realmente después de la comisión de una app, marketplace, tarjeta o plataforma de cobro.</p>
    <section style={{display:"grid",gap:16,marginTop:32}}>
      <label>Precio de venta ($)<input aria-label="Precio de venta" type="number" min="0" value={venta} onChange={e=>setVenta(Number(e.target.value))} style={inputStyle}/></label>
      <label>Comisión total (%)<input aria-label="Comisión porcentual" type="number" min="0" max="100" step="0.1" value={comision} onChange={e=>setComision(Number(e.target.value))} style={inputStyle}/></label>
      <label>Cargo fijo por venta ($)<input aria-label="Cargo fijo" type="number" min="0" value={fijo} onChange={e=>setFijo(Number(e.target.value))} style={inputStyle}/></label>
      <label>Costo del producto o servicio ($)<input aria-label="Costo del producto" type="number" min="0" value={costo} onChange={e=>setCosto(Number(e.target.value))} style={inputStyle}/></label>
    </section>
    <section style={{marginTop:32,padding:24,border:"1px solid currentColor",borderRadius:16}}>
      <p>Comisión y cargos: <strong>{money.format(r.fee)}</strong></p>
      <p>Te deposita la plataforma: <strong>{money.format(r.neto)}</strong></p>
      <p>Resultado después del costo</p><h2>{money.format(r.ganancia)}</h2>
      <p>Margen real sobre la venta: <strong>{r.margen.toFixed(1)}%</strong></p>
      {r.precioParaNeto !== null && <p>Precio mínimo para recuperar solo tu costo con esa comisión: <strong>{money.format(r.precioParaNeto)}</strong></p>}
    </section>
    <section style={{marginTop:32}}>
      <h2>¿Para qué sirve?</h2>
      <p>Una venta de $10.000 no siempre son $10.000 para tu negocio. Apps de delivery, marketplaces, medios de pago y otras plataformas pueden descontar un porcentaje y cargos fijos. Esta calculadora te permite usar la tasa exacta de tu liquidación sin asumir una comisión estándar.</p>
      <h2>¿Cómo se calcula?</h2>
      <p>Neto = precio de venta − (precio × comisión %) − cargo fijo. El resultado del negocio descuenta además el costo del producto o servicio.</p>
      <h2>Usalo con tu liquidación real</h2>
      <p>Ingresá el porcentaje efectivo que te cobra tu canal. Si cambia según promociones, impuestos o condiciones comerciales, calculá cada escenario por separado.</p>
      <Link href="/" style={{fontWeight:700}}>Conocé Lebu →</Link><span> · </span><Link href="/calculadora-precio-venta">Calculá tu precio de venta →</Link>
    </section>
    <p style={{marginTop:40,fontSize:13,opacity:.7}}>Resultado orientativo. Verificá siempre la liquidación y condiciones vigentes de cada plataforma.</p>
  </main>;
}
