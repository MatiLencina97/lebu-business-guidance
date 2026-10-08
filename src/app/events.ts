export type BusinessEventStatus = 'lead' | 'quoted' | 'confirmed' | 'done' | 'cancelled';

export type BusinessEvent = {
  id: number;
  businessId: string;
  date: string;
  name: string;
  location: string;
  attendees: number;
  averageTicket: number;
  fixedCost: number;
  variableCostPerPerson: number;
  expectedConversionPct: number;
  status: BusinessEventStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type EventQuoteInput = {
  attendees: number;
  averageTicket: number;
  fixedCost: number;
  variableCostPerPerson: number;
  expectedConversionPct: number;
};

export type EventQuoteResult = {
  totalCost: number;
  ticketsNeeded: number;
  requiredConversionPct: number;
  expectedTickets: number;
  expectedRevenue: number;
  expectedResult: number;
  maxRevenue: number;
  breakEvenPossibleWithOneTicketEach: boolean;
  averageTicketNeededAtExpectedConversion: number;
};

function finite(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateEventQuote(input: EventQuoteInput): EventQuoteResult {
  const attendees = Math.max(Math.floor(finite(input.attendees)), 0);
  const averageTicket = Math.max(finite(input.averageTicket), 0);
  const fixedCost = Math.max(finite(input.fixedCost), 0);
  const variableCostPerPerson = Math.max(finite(input.variableCostPerPerson), 0);
  const expectedConversionPct = Math.min(Math.max(finite(input.expectedConversionPct), 0), 100);

  const totalCost = fixedCost + attendees * variableCostPerPerson;
  const ticketsNeeded = averageTicket > 0 ? Math.ceil(totalCost / averageTicket) : 0;
  const requiredConversionPct = attendees > 0 && ticketsNeeded > 0 ? (ticketsNeeded / attendees) * 100 : 0;
  const expectedTickets = attendees > 0 ? Math.floor(attendees * expectedConversionPct / 100) : 0;
  const expectedRevenue = expectedTickets * averageTicket;
  const expectedResult = expectedRevenue - totalCost;
  const maxRevenue = attendees * averageTicket;
  const breakEvenPossibleWithOneTicketEach = totalCost <= 0 || (attendees > 0 && averageTicket > 0 && ticketsNeeded <= attendees);
  const averageTicketNeededAtExpectedConversion = totalCost <= 0
    ? 0
    : expectedTickets > 0
      ? totalCost / expectedTickets
      : Number.POSITIVE_INFINITY;

  return {
    totalCost,
    ticketsNeeded,
    requiredConversionPct,
    expectedTickets,
    expectedRevenue,
    expectedResult,
    maxRevenue,
    breakEvenPossibleWithOneTicketEach,
    averageTicketNeededAtExpectedConversion,
  };
}
