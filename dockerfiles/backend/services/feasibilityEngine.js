/**
 * Feasibility Engine
 *
 * Given a structured course analysis and the cloud service catalog, decide
 * whether GetLabs can run this course as a sandbox, and if so, under what
 * conditions.
 *
 * Verdicts:
 *   feasible       - every service is supported & safe. Ship it.
 *   needs_review   - everything is supported, but at least one service is
 *                    in the "dangerous" or "moderate" tier. Ops should eyeball.
 *   partial        - some services are unsupported, but not all. Can still
 *                    ship if customer accepts the gap.
 *   infeasible     - the core of the course relies on unsupported services.
 */

const { catalog } = require('../data/cloudServiceCatalog');

const SPECIAL_FLAG_RULES = [
  { match: /gpu/i,           flag: 'GPU requested — GetLabs sandbox does not provision GPU instances.' },
  { match: /bare.?metal/i,   flag: 'Bare-metal requested — not supported in sandbox.' },
  { match: /dedicated.?host/i, flag: 'Dedicated host requested — not supported.' },
  { match: /multi.?region/i, flag: 'Multi-region requested — increases cost, review budget cap.' },
  { match: /cross.?region/i, flag: 'Cross-region requested — increases cost.' },
  { match: /hybrid/i,        flag: 'Hybrid networking requested — not supported in sandbox.' },
  { match: /cross.?account/i,flag: 'Cross-account requested — sandbox is single-account only.' },
  { match: /on.?prem/i,      flag: 'On-prem integration requested — not supported.' },
  { match: /quantum/i,       flag: 'Quantum services requested — not supported.' },
];

function collectUniqueServices(analysis) {
  const seen = new Map();
  for (const mod of analysis.modules || []) {
    for (const svc of mod.services || []) {
      const key = (svc.name || '').toLowerCase().trim();
      if (!key) continue;
      if (!seen.has(key)) {
        seen.set(key, { name: key, usage: svc.usage, modules: [] });
      }
      seen.get(key).modules.push(mod.name);
    }
  }
  return Array.from(seen.values());
}

function evaluateFeasibility(analysis) {
  if (!analysis || !analysis.detectedProvider) {
    return {
      verdict: 'infeasible',
      supported: [],
      needsReview: [],
      unsupported: [],
      riskFlags: ['Analysis did not detect a cloud provider.'],
    };
  }

  // Empty-analysis guard: a course with no modules or no hours isn't
  // "feasible" — it means the analyzer couldn't find / infer enough structure
  // from the PDF. Flag it clearly so ops either re-upload or edit manually.
  const moduleCount = (analysis.modules || []).length;
  const totalHours = Number(analysis.totalHours) || 0;
  if (moduleCount === 0 || totalHours === 0) {
    return {
      verdict: 'needs_review',
      supported: [],
      needsReview: [],
      unsupported: [],
      riskFlags: [
        'No module breakdown was extracted from the PDF. The upload was likely a marketing brief or short outline rather than a detailed course TOC. Options: (1) upload a more detailed course outline, or (2) click Edit and add the modules/services manually before locking the deal.',
      ],
    };
  }

  const provider = analysis.detectedProvider;

  // Multi-cloud courses: we evaluate against all three catalogs and mark
  // anything not in any as unsupported. The template generator will still
  // pick one provider to build for.
  const catalogsToCheck = provider === 'multi'
    ? [catalog.aws, catalog.azure, catalog.gcp]
    : [catalog[provider]];

  if (!catalogsToCheck[0]) {
    return {
      verdict: 'infeasible',
      supported: [],
      needsReview: [],
      unsupported: [],
      riskFlags: [`Unknown provider: ${provider}`],
    };
  }

  const supported = [];
  const needsReview = [];
  const unsupported = [];

  for (const svc of collectUniqueServices(analysis)) {
    let entry = null;
    for (const cat of catalogsToCheck) {
      if (cat[svc.name]) {
        entry = cat[svc.name];
        break;
      }
    }

    if (!entry) {
      unsupported.push({
        service: svc.name,
        reason: 'Not in supported catalog. Ops can add to cloudServiceCatalog.js if legitimate.',
      });
      continue;
    }

    const hit = {
      service: svc.name,
      category: entry.category,
      riskTier: entry.riskTier,
      reason: entry.notes || '',
    };

    if (entry.riskTier === 'blocked') {
      unsupported.push({ ...hit, reason: entry.notes || 'Blocked by policy.' });
    } else if (entry.riskTier === 'dangerous') {
      needsReview.push({ ...hit, reason: entry.notes || 'Expensive / high-risk — manual review.' });
    } else if (entry.riskTier === 'moderate') {
      needsReview.push({ ...hit, reason: entry.notes || 'Moderate cost — verify budget.' });
    } else {
      supported.push(hit);
    }
  }

  // Risk flags from specialRequirements
  const riskFlags = [];
  for (const req of analysis.specialRequirements || []) {
    for (const rule of SPECIAL_FLAG_RULES) {
      if (rule.match.test(req)) {
        riskFlags.push(rule.flag);
      }
    }
  }

  // Decide verdict
  let verdict;
  const hasBlocker = unsupported.some(u => u.reason && u.reason.toLowerCase().includes('blocked'));

  if (unsupported.length === 0 && needsReview.length === 0 && riskFlags.length === 0) {
    verdict = 'feasible';
  } else if (unsupported.length === 0) {
    verdict = 'needs_review';
  } else if (supported.length === 0 && needsReview.length === 0) {
    verdict = 'infeasible';
  } else if (hasBlocker) {
    verdict = 'partial';
  } else {
    verdict = 'partial';
  }

  return { verdict, supported, needsReview, unsupported, riskFlags };
}

module.exports = { evaluateFeasibility, collectUniqueServices };
