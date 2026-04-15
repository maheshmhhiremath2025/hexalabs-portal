/**
 * B2B Cost Calculator
 *
 * Given a course analysis + feasibility result + seat count, produce a
 * per-seat and total INR estimate for ops to quote the customer.
 *
 * Math:
 *   per_module_service_cost = hours * baselineHourlyInr
 *   per_seat_subtotal       = sum(per_module_service_cost) + flat baseline
 *   per_seat_quote          = per_seat_subtotal * (1 + marginPercent/100)
 *   total_quote             = per_seat_quote * seats
 *
 * Services not in the catalog contribute 0 (with a note) — they'll show up
 * in feasibility as unsupported so the quote isn't silently under-priced.
 *
 * The margin defaults to 40% — a lot for cloud resources, but this is a
 * training product with ops/support overhead baked in. Configurable per
 * analysis via requestedMarginPercent.
 */

const { catalog, baselinePerSeatInr } = require('../data/cloudServiceCatalog');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function calculateCost(analysis, { seats = 1, marginPercent = 40 } = {}) {
  if (!analysis || !analysis.detectedProvider) {
    return {
      perSeatInr: 0,
      totalInr: 0,
      breakdown: [],
      marginPercent,
      baselineSeatInr: 0,
      currency: 'INR',
      unpriced: [],
    };
  }

  const provider = analysis.detectedProvider === 'multi' ? 'aws' : analysis.detectedProvider;
  const providerCatalog = catalog[provider] || {};
  const baseline = baselinePerSeatInr[provider] || 20;

  const breakdown = [];
  const unpriced = [];
  let perSeatSubtotal = 0;

  for (const mod of analysis.modules || []) {
    const hours = Number(mod.hours) || 0;
    if (hours <= 0) continue;

    for (const svc of mod.services || []) {
      const svcName = (svc.name || '').toLowerCase().trim();
      if (!svcName) continue;

      const entry = providerCatalog[svcName];
      if (!entry) {
        unpriced.push({ module: mod.name, service: svcName, reason: 'not in catalog' });
        continue;
      }

      const rate = Number(entry.baselineHourlyInr) || 0;
      const subtotal = rate * hours;
      perSeatSubtotal += subtotal;

      breakdown.push({
        module: mod.name,
        service: svcName,
        hours,
        rate: round2(rate),
        subtotal: round2(subtotal),
      });
    }
  }

  // Flat per-seat overhead (IAM, activity logs, small default storage).
  perSeatSubtotal += baseline;

  const marginMultiplier = 1 + (Number(marginPercent) || 0) / 100;
  const perSeatQuote = round2(perSeatSubtotal * marginMultiplier);
  const totalQuote = round2(perSeatQuote * (Number(seats) || 1));

  return {
    perSeatInr: perSeatQuote,
    totalInr: totalQuote,
    breakdown,
    marginPercent,
    baselineSeatInr: baseline,
    currency: 'INR',
    unpriced,
  };
}

module.exports = { calculateCost };
