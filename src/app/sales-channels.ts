export type SalesChannelFeeRule = {
  id: number;
  name: string;
  feePct: number;
  aliases?: string[];
};

export type SalesChannelSaleLike = {
  amount?: string | number;
  channel?: string;
  source?: string;
  sourceMetadata?: Record<string, unknown>;
  paymentBreakdown?: Array<{ methodName?: string; amount?: number }>;
};

function finite(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeSalesChannel(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeSalesChannelFeeRules(value: unknown): SalesChannelFeeRule[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<number>();
  return value
    .map((item: any, index) => {
      const name = String(item?.name || '').trim();
      const feePct = Math.min(Math.max(finite(item?.feePct), 0), 100);
      const rawId = Number(item?.id);
      const id = Number.isFinite(rawId) && rawId > 0 && !used.has(rawId)
        ? rawId
        : Date.now() * 1000 + index + 1;
      used.add(id);
      const aliases = Array.isArray(item?.aliases)
        ? [...new Set(item.aliases.map((alias: unknown) => String(alias || '').trim()).filter(Boolean))]
        : [];
      return name ? { id, name, feePct, aliases } : null;
    })
    .filter((item): item is SalesChannelFeeRule => Boolean(item));
}

function metadataCandidates(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return [] as string[];
  const keys = ['channel', 'origin', 'origen', 'saleChannel', 'salesChannel', 'sourceName', 'marketplace', 'deliveryPlatform', 'saleType'];
  return keys
    .map((key) => metadata[key])
    .filter((value) => typeof value === 'string')
    .map(String);
}

export function salesChannelCandidates(sale: SalesChannelSaleLike) {
  return [
    sale.channel || '',
    ...metadataCandidates(sale.sourceMetadata),
    ...(sale.paymentBreakdown || []).map((item) => String(item?.methodName || '')),
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

export function matchSalesChannelRule(sale: SalesChannelSaleLike, rules: SalesChannelFeeRule[]) {
  const candidates = salesChannelCandidates(sale).map(normalizeSalesChannel).filter(Boolean);
  if (!candidates.length || !rules.length) return null;

  for (const rule of rules) {
    const names = [rule.name, ...(rule.aliases || [])].map(normalizeSalesChannel).filter(Boolean);
    if (!names.length) continue;
    const matches = candidates.some((candidate) => names.some((name) => candidate === name || candidate.includes(name) || name.includes(candidate)));
    if (matches) return rule;
  }
  return null;
}

export function saleChannelFee(sale: SalesChannelSaleLike, rules: SalesChannelFeeRule[]) {
  const amount = Math.max(finite(String(sale.amount ?? '').replace(/[^0-9.-]/g, '')), 0);
  const rule = matchSalesChannelRule(sale, rules);
  if (!rule || amount <= 0 || rule.feePct <= 0) return { fee: 0, rate: 0, rule: null };
  const rate = rule.feePct / 100;
  return { fee: amount * rate, rate, rule };
}

export function netSaleContribution(sale: SalesChannelSaleLike, rules: SalesChannelFeeRule[]) {
  const amount = Math.max(finite(String(sale.amount ?? '').replace(/[^0-9.-]/g, '')), 0);
  return Math.max(amount - saleChannelFee(sale, rules).fee, 0);
}
