export type ProductionShelfLife = 'same_day' | 'carry' | 'durable';
export type ProductionEventType = 'opening' | 'prep_started' | 'prep_ready' | 'manual_sale' | 'waste' | 'carry' | 'adjustment';

export type ProductionProduct = {
  id: number;
  businessId: string;
  name: string;
  unitCost: number | null;
  shelfLife: ProductionShelfLife;
  saleAliases: string[];
  active: boolean;
  sortOrder: number;
};

export type ProductionEvent = {
  id: number;
  businessId: string;
  productId: number;
  date: string;
  type: ProductionEventType;
  quantity: number;
  occurredAt: string;
  note?: string;
};

export type ProductionDay = {
  businessId: string;
  date: string;
  closedAt: string | null;
};

export type ProductionSaleLike = {
  date: string;
  occurredAt?: string;
  items?: Array<{ name: string; quantity?: number; amount?: number; category?: string }>;
};

export type ProductionProductDayStatus = {
  product: ProductionProduct;
  date: string;
  opening: number;
  prepStarted: number;
  prepReady: number;
  inPreparation: number;
  adjustments: number;
  sold: number;
  waste: number;
  carry: number;
  rawAvailable: number;
  available: number;
  oversold: number;
  totalMadeAvailable: number;
  wasteCost: number;
  matchedSaleRows: number;
  automaticSold: number;
  manualSold: number;
};

export type ProductionInsightTone = 'positive' | 'attention' | 'neutral';
export type ProductionInsightKind = 'reduce' | 'increase' | 'keep' | 'learning';

export type ProductionInsight = {
  id: string;
  productId: number;
  productName: string;
  kind: ProductionInsightKind;
  tone: ProductionInsightTone;
  title: string;
  body: string;
  evidence: string;
  sampleDays: number;
  wasteRate: number;
  sellThrough: number;
  estimatedWasteCost: number;
  suggestedDelta: number | null;
};

export type ProductionAnalysis = {
  available: boolean;
  productSalesDetailAvailable: boolean;
  closedDays: number;
  totalWasteCost: number;
  totalWasteUnits: number;
  insights: ProductionInsight[];
  learningMessage: string;
};

function finite(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeProductionName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function aliasesForProduct(product: ProductionProduct) {
  const aliases = [product.name, ...(Array.isArray(product.saleAliases) ? product.saleAliases : [])]
    .map(normalizeProductionName)
    .filter(Boolean);
  return new Set(aliases);
}

export function saleItemQuantityForProduct(sale: ProductionSaleLike, product: ProductionProduct) {
  if (!Array.isArray(sale.items)) return 0;
  const aliases = aliasesForProduct(product);
  return sale.items.reduce((sum, item) => {
    if (!aliases.has(normalizeProductionName(item?.name || ''))) return sum;
    const quantity = finite(item?.quantity ?? 1);
    return sum + (quantity > 0 ? quantity : 0);
  }, 0);
}

export function soldQuantityForProductDate(sales: ProductionSaleLike[], product: ProductionProduct, date: string) {
  return (sales || []).reduce((sum, sale) => sale?.date === date ? sum + saleItemQuantityForProduct(sale, product) : sum, 0);
}

export function hasProductSalesDetail(sales: ProductionSaleLike[]) {
  return (sales || []).some((sale) => Array.isArray(sale?.items) && sale.items.some((item) => normalizeProductionName(item?.name || '')));
}

export function detectedProductNamesFromSales(sales: ProductionSaleLike[], limit = 80) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const sale of sales || []) {
    for (const item of sale.items || []) {
      const key = normalizeProductionName(item?.name || '');
      if (!key) continue;
      const current = counts.get(key);
      counts.set(key, { label: String(item.name).trim(), count: (current?.count || 0) + 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'))
    .slice(0, limit)
    .map((item) => item.label);
}

export function buildProductionDayStatus({
  date,
  products,
  events,
  sales,
}: {
  date: string;
  products: ProductionProduct[];
  events: ProductionEvent[];
  sales: ProductionSaleLike[];
}) {
  const dayEvents = (events || []).filter((event) => event.date === date);
  return (products || []).filter((product) => product.active !== false).map<ProductionProductDayStatus>((product) => {
    const productEvents = dayEvents.filter((event) => event.productId === product.id);
    const sumType = (type: ProductionEventType) => productEvents
      .filter((event) => event.type === type)
      .reduce((sum, event) => sum + finite(event.quantity), 0);
    const opening = sumType('opening');
    const prepStarted = sumType('prep_started');
    const prepReady = sumType('prep_ready');
    const waste = sumType('waste');
    const carry = sumType('carry');
    const adjustments = sumType('adjustment');
    const manualSold = Math.max(sumType('manual_sale'), 0);
    const automaticSold = soldQuantityForProductDate(sales, product, date);
    const matchedSaleRows = (sales || []).filter((sale) => sale.date === date && saleItemQuantityForProduct(sale, product) > 0).length;
    // Si para ese producto/día ya existen ítems de venta automáticos, esos son la fuente de verdad.
    // El conteo manual es el fallback para períodos donde FUDO/importación aún no traen detalle.
    const sold = matchedSaleRows > 0 ? automaticSold : manualSold;
    const inPreparation = Math.max(prepStarted - prepReady, 0);
    const totalMadeAvailable = Math.max(opening + prepReady + Math.max(adjustments, 0), 0);
    const rawAvailable = opening + prepReady + adjustments - sold - waste - carry;
    const available = Math.max(rawAvailable, 0);
    const oversold = Math.max(-rawAvailable, 0);
    const wasteCost = waste * Math.max(product.unitCost || 0, 0);
    return {
      product,
      date,
      opening,
      prepStarted,
      prepReady,
      inPreparation,
      adjustments,
      sold,
      waste,
      carry,
      rawAvailable,
      available,
      oversold,
      totalMadeAvailable,
      wasteCost,
      matchedSaleRows,
      automaticSold,
      manualSold,
    };
  });
}

function saleItemEventsForProductDate(sales: ProductionSaleLike[], events: ProductionEvent[], product: ProductionProduct, date: string) {
  const automatic = (sales || [])
    .filter((sale) => sale.date === date && sale.occurredAt && saleItemQuantityForProduct(sale, product) > 0)
    .map((sale) => ({
      at: String(sale.occurredAt),
      quantity: saleItemQuantityForProduct(sale, product),
    }))
    .filter((item) => !Number.isNaN(Date.parse(item.at)));
  if (automatic.length) return automatic.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (events || [])
    .filter((event) => event.date === date && event.productId === product.id && event.type === 'manual_sale' && event.occurredAt)
    .map((event) => ({ at: event.occurredAt, quantity: Math.max(finite(event.quantity), 0) }))
    .filter((item) => item.quantity > 0 && !Number.isNaN(Date.parse(item.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function likelyStockoutBeforeClose({
  product,
  date,
  events,
  sales,
  day,
}: {
  product: ProductionProduct;
  date: string;
  events: ProductionEvent[];
  sales: ProductionSaleLike[];
  day?: ProductionDay;
}) {
  if (!day?.closedAt) return false;
  const closeMs = Date.parse(day.closedAt);
  if (!Number.isFinite(closeMs)) return false;
  const saleEvents = saleItemEventsForProductDate(sales, events, product, date);
  if (!saleEvents.length) return false;
  const supplyEvents = (events || [])
    .filter((event) => event.date === date && event.productId === product.id && (event.type === 'opening' || event.type === 'prep_ready' || event.type === 'adjustment'))
    .map((event) => ({
      at: event.type === 'opening' ? `${date}T00:00:00` : event.occurredAt,
      quantity: event.type === 'adjustment' ? event.quantity : Math.max(event.quantity, 0),
    }))
    .filter((item) => !Number.isNaN(Date.parse(item.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  let supply = 0;
  let sold = 0;
  let supplyIndex = 0;
  for (const sale of saleEvents) {
    const saleMs = Date.parse(sale.at);
    while (supplyIndex < supplyEvents.length && Date.parse(supplyEvents[supplyIndex].at) <= saleMs) {
      supply += supplyEvents[supplyIndex].quantity;
      supplyIndex += 1;
    }
    sold += sale.quantity;
    if (supply > 0 && sold >= supply) {
      const nextSupplyAt = supplyEvents[supplyIndex] ? Date.parse(supplyEvents[supplyIndex].at) : closeMs;
      const unavailableUntil = Math.min(nextSupplyAt, closeMs);
      // Señal conservadora: solo hablamos de posible quiebre si quedaron al menos 90 minutos
      // de jornada sin disponibilidad antes de otra tanda o del cierre.
      if (unavailableUntil - saleMs >= 90 * 60 * 1000) return true;
    }
  }
  return false;
}

export function buildProductionAnalysis({
  products,
  events,
  days,
  sales,
  today,
  lookbackDays = 42,
}: {
  products: ProductionProduct[];
  events: ProductionEvent[];
  days: ProductionDay[];
  sales: ProductionSaleLike[];
  today: string;
  lookbackDays?: number;
}): ProductionAnalysis {
  const automaticDetailAvailable = hasProductSalesDetail(sales);
  const manualDetailAvailable = (events || []).some((event) => event.type === 'manual_sale');
  const detailAvailable = automaticDetailAvailable || manualDetailAvailable;
  const todayMs = Date.parse(`${today}T12:00:00`);
  const cutoffMs = todayMs - lookbackDays * 86400000;
  const closedDays = (days || []).filter((day) => day.closedAt && Date.parse(`${day.date}T12:00:00`) >= cutoffMs && day.date <= today);
  const closedDates = new Set(closedDays.map((day) => day.date));
  let totalWasteCost = 0;
  let totalWasteUnits = 0;
  const insights: ProductionInsight[] = [];

  for (const product of (products || []).filter((item) => item.active !== false)) {
    const rows = [...closedDates]
      .sort()
      .map((date) => {
        const status = buildProductionDayStatus({ date, products: [product], events, sales })[0];
        const day = closedDays.find((item) => item.date === date);
        const supply = Math.max(status.opening + status.prepReady + Math.max(status.adjustments, 0), 0);
        const wasteRate = supply > 0 ? status.waste / supply : 0;
        const sellThrough = supply > 0 ? Math.min(status.sold / supply, 1) : 0;
        const stockout = likelyStockoutBeforeClose({ product, date, events, sales, day });
        return { ...status, supply, wasteRate, sellThrough, stockout };
      })
      .filter((row) => row.supply > 0 || row.sold > 0 || row.waste > 0);

    const sampleDays = rows.length;
    const wasteUnits = rows.reduce((sum, row) => sum + row.waste, 0);
    const wasteCost = rows.reduce((sum, row) => sum + row.wasteCost, 0);
    totalWasteUnits += wasteUnits;
    totalWasteCost += wasteCost;
    const productTrackingAvailable = automaticDetailAvailable || (events || []).some((event) => event.type === 'manual_sale' && event.productId === product.id);
    if (sampleDays < 3 || !productTrackingAvailable) continue;

    const totalSupply = rows.reduce((sum, row) => sum + row.supply, 0);
    const totalSold = rows.reduce((sum, row) => sum + row.sold, 0);
    const wasteRate = totalSupply > 0 ? wasteUnits / totalSupply : 0;
    const sellThrough = totalSupply > 0 ? Math.min(totalSold / totalSupply, 1) : 0;
    const stockoutDays = rows.filter((row) => row.stockout).length;
    const avgSupply = totalSupply / sampleDays;
    const avgWaste = wasteUnits / sampleDays;

    if (wasteRate >= 0.18 && avgWaste >= 1) {
      const suggestedDelta = -Math.max(1, Math.round(Math.min(avgWaste * 0.7, avgSupply * 0.2)));
      insights.push({
        id: `reduce-${product.id}`,
        productId: product.id,
        productName: product.name,
        kind: 'reduce',
        tone: 'attention',
        title: `Estás dejando demasiado ${product.name} al cierre`,
        body: `En los últimos ${sampleDays} cierres con datos, la merma fue de aproximadamente ${Math.round(wasteRate * 100)}% de lo que pusiste disponible. Probá arrancar con ${Math.abs(suggestedDelta)} unidad${Math.abs(suggestedDelta) === 1 ? '' : 'es'} menos y medí una semana.`,
        evidence: `${Math.round(wasteUnits)} unidades descartadas${wasteCost > 0 ? ` · costo estimado ${Math.round(wasteCost)}` : ''}`,
        sampleDays,
        wasteRate,
        sellThrough,
        estimatedWasteCost: wasteCost,
        suggestedDelta,
      });
      continue;
    }

    if (stockoutDays >= Math.max(2, Math.ceil(sampleDays * 0.4)) && wasteRate <= 0.08) {
      const suggestedDelta = Math.max(1, Math.round(Math.max(avgSupply * 0.12, 1)));
      insights.push({
        id: `increase-${product.id}`,
        productId: product.id,
        productName: product.name,
        kind: 'increase',
        tone: 'positive',
        title: `${product.name} parece quedarse corto`,
        body: `Lebu detectó posibles quiebres antes del cierre en ${stockoutDays} de ${sampleDays} días y casi no hubo merma. Probá sumar unas ${suggestedDelta} unidad${suggestedDelta === 1 ? '' : 'es'} a la disponibilidad del día.`,
        evidence: `${stockoutDays}/${sampleDays} días con señal de quiebre · merma ${Math.round(wasteRate * 100)}%`,
        sampleDays,
        wasteRate,
        sellThrough,
        estimatedWasteCost: wasteCost,
        suggestedDelta,
      });
      continue;
    }

    if (sampleDays >= 5 && wasteRate <= 0.08 && sellThrough >= 0.82) {
      insights.push({
        id: `keep-${product.id}`,
        productId: product.id,
        productName: product.name,
        kind: 'keep',
        tone: 'neutral',
        title: `${product.name} está bastante equilibrado`,
        body: 'La mayor parte de lo disponible se vende y la merma viene siendo baja. No tocaría fuerte la cantidad por ahora.',
        evidence: `Sell-through ${Math.round(sellThrough * 100)}% · merma ${Math.round(wasteRate * 100)}%`,
        sampleDays,
        wasteRate,
        sellThrough,
        estimatedWasteCost: wasteCost,
        suggestedDelta: null,
      });
    }
  }

  const ranked = insights.sort((a, b) => {
    const priority = (item: ProductionInsight) => item.kind === 'reduce' ? 0 : item.kind === 'increase' ? 1 : 2;
    return priority(a) - priority(b) || b.estimatedWasteCost - a.estimatedWasteCost || b.sampleDays - a.sampleDays;
  }).slice(0, 4);

  let learningMessage = 'Cerrá algunas jornadas de producción para que Lebu pueda comparar disponibilidad, ventas y merma.';
  if (!detailAvailable) learningMessage = 'Lebu todavía no recibe detalle de productos dentro de las ventas. Mientras tanto podés registrar unidades vendidas desde Producción; cuando FUDO o una importación entreguen ítems, Lebu las descontará automáticamente.';
  else if (closedDays.length < 3) learningMessage = 'Ya conozco qué productos se venden. Necesito al menos 3 cierres de producción para recomendar cantidades sin adivinar.';
  else if (!ranked.length) learningMessage = 'Ya hay datos de producción, pero todavía no aparece una señal suficientemente clara como para recomendar subir o bajar cantidades.';

  return {
    available: products.length > 0,
    productSalesDetailAvailable: detailAvailable,
    closedDays: closedDays.length,
    totalWasteCost,
    totalWasteUnits,
    insights: ranked,
    learningMessage,
  };
}

export function buildProductionHomeAlert(statuses: ProductionProductDayStatus[]) {
  const candidates = (statuses || [])
    .filter((status) => status.sold > 0 || status.opening > 0 || status.prepReady > 0 || status.inPreparation > 0)
    .map((status) => {
      const lowThreshold = Math.max(2, Math.ceil(status.sold * 0.2));
      const isOut = status.available <= 0 && status.inPreparation <= 0;
      const isLow = status.available > 0 && status.available <= lowThreshold;
      return { status, isOut, isLow };
    })
    .filter((item) => item.isOut || item.isLow)
    .sort((a, b) => Number(b.isOut) - Number(a.isOut) || a.status.available - b.status.available);
  if (!candidates.length) return null;
  const first = candidates[0];
  const status = first.status;
  if (first.isOut) {
    return {
      tone: 'attention' as const,
      title: `${status.product.name} está sin disponibilidad registrada`,
      body: status.inPreparation > 0
        ? `Hay ${status.inPreparation} en preparación.`
        : `Vendiste ${Math.round(status.sold)} hoy y Lebu no ve unidades disponibles ni en preparación.`,
    };
  }
  return {
    tone: 'neutral' as const,
    title: `Queda poco ${status.product.name}`,
    body: `Disponibles ${Math.round(status.available)}${status.inPreparation > 0 ? ` · ${Math.round(status.inPreparation)} en preparación` : ''}.`,
  };
}
