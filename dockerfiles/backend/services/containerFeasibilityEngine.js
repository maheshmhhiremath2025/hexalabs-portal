/**
 * Container Feasibility Engine
 *
 * Deterministic image matcher for container_lab courses. Given a list of
 * software the customer wants pre-installed, it walks the container image
 * catalog (data/containerImageCapabilities.js), scores each image's
 * coverage, and picks the best match.
 *
 * This is intentionally NOT an LLM call. The LLM extracts the software
 * list from the PDF; this engine then makes a reproducible, auditable
 * decision about which catalog image fits. Same input → same answer
 * every time.
 *
 * Returns:
 *   {
 *     verdict: 'feasible' | 'needs_review' | 'partial' | 'infeasible',
 *     bestMatch: {
 *       imageKey, label, category,
 *       matched: [...],     // requested items that this image provides
 *       addable: [...],     // requested items that can be installed at runtime
 *       missing: [...],     // requested items neither provided nor addable
 *       coveragePercent,    // matched / requested
 *       softCoveragePercent // (matched + addable) / requested
 *     },
 *     alternatives: [...next 2-3 images],
 *     requestedSoftware: [normalized list],
 *     riskFlags: [...]
 *   }
 *
 * Verdict thresholds:
 *   feasible       — coveragePercent === 100 (all software preinstalled)
 *   needs_review   — softCoverage 100% AND coverage >= 70% (some addable)
 *   partial        — softCoverage >= 60%
 *   infeasible     — softCoverage < 60% (no image fits well enough)
 */

const { IMAGE_CAPABILITIES, normalizeSoftware, splitAndNormalize } = require('../data/containerImageCapabilities');

function scoreImage(imageKey, capability, requestedNorm) {
  const provided     = new Set((capability.provides     || []).map(p => p.toLowerCase().trim()));
  const addable      = new Set((capability.addable      || []).map(p => p.toLowerCase().trim()));
  const notSupported = new Set((capability.notSupported || []).map(p => p.toLowerCase().trim()));
  const keywords     = (capability.keywords || []).map(k => k.toLowerCase().trim());

  const matched = [];
  const addableHits = [];
  const missing = [];

  for (const req of requestedNorm) {
    if (!req) continue;

    // 0. Hard exclude: if this image explicitly does not support the item,
    //    skip provides/addable matching entirely. This prevents false
    //    positives when a substring would otherwise match (e.g. "cassandra"
    //    against an image that has "cassandra-driver" but not the database).
    let excluded = false;
    if (notSupported.has(req)) excluded = true;
    if (!excluded) {
      for (const ns of notSupported) {
        if (req === ns || req.includes(ns) || ns.includes(req)) { excluded = true; break; }
      }
    }
    if (excluded) {
      missing.push(req);
      continue;
    }

    // 1. Direct provides match: exact or substring (either direction)
    let hit = false;
    if (provided.has(req)) hit = true;
    if (!hit) {
      for (const p of provided) {
        if (req.includes(p) || p.includes(req)) { hit = true; break; }
      }
    }
    // Keyword soft-hit: if the customer typed "data engineering" and the
    // image declares that as a keyword, count it as provided too.
    if (!hit) {
      for (const k of keywords) {
        if (req.includes(k) || k.includes(req)) { hit = true; break; }
      }
    }
    if (hit) {
      matched.push(req);
      continue;
    }

    // 2. Addable: installable at runtime, weaker hit
    let addableHit = false;
    if (addable.has(req)) addableHit = true;
    if (!addableHit) {
      for (const a of addable) {
        if (req.includes(a) || a.includes(req)) { addableHit = true; break; }
      }
    }
    if (addableHit) {
      addableHits.push(req);
      continue;
    }

    // 3. Missing — not provided, not addable
    missing.push(req);
  }

  const total = requestedNorm.length || 1;
  const coveragePercent = Math.round(matched.length * 100 / total);
  const softCoveragePercent = Math.round((matched.length + addableHits.length) * 100 / total);

  return {
    imageKey,
    label: capability.label,
    category: capability.category,
    matched,
    addable: addableHits,
    missing,
    coveragePercent,
    softCoveragePercent,
  };
}

/**
 * Main entry point. Takes a CourseAnalysis-like object (the .analysis subdoc)
 * and returns a feasibility verdict for container_lab deployment.
 */
function evaluateContainerFeasibility(analysis) {
  const requestedRaw = analysis?.containerLab?.requestedVmSpec?.software || [];

  // Also fold in keywords from the course title/description in case the
  // customer didn't list specific tools but the topic is recognizable.
  const titleAndDesc = `${analysis?.courseName || ''} ${analysis?.description || ''}`.toLowerCase();

  // Split (on / , and, or) and normalize and dedupe — so "MySQL/Cassandra"
  // becomes two separate items.
  const normSet = new Set();
  for (const s of requestedRaw) {
    for (const part of splitAndNormalize(s)) {
      normSet.add(part);
    }
  }
  const requestedNorm = Array.from(normSet);

  if (requestedNorm.length === 0) {
    return {
      verdict: 'needs_review',
      bestMatch: null,
      alternatives: [],
      requestedSoftware: [],
      riskFlags: [
        'No specific software was extracted from the PDF. The analyzer may need a more detailed PDF, or ops should manually edit the analysis to add the software stack.',
      ],
    };
  }

  // Score every image in the catalog
  const scores = [];
  for (const [key, cap] of Object.entries(IMAGE_CAPABILITIES)) {
    scores.push(scoreImage(key, cap, requestedNorm));
  }

  // Sort by softCoverage desc, then coverage desc, then prefer bigdata category
  // for big-data-flavored requests.
  scores.sort((a, b) => {
    if (b.softCoveragePercent !== a.softCoveragePercent) return b.softCoveragePercent - a.softCoveragePercent;
    if (b.coveragePercent !== a.coveragePercent) return b.coveragePercent - a.coveragePercent;
    return 0;
  });

  const best = scores[0];
  const alternatives = scores
    .slice(1)
    .filter(s => s.softCoveragePercent >= 30) // ignore obvious mismatches
    .slice(0, 3);

  // Decide verdict
  let verdict;
  if (best.coveragePercent === 100) {
    verdict = 'feasible';
  } else if (best.softCoveragePercent === 100) {
    verdict = 'needs_review'; // everything covered IF we install some at runtime
  } else if (best.softCoveragePercent >= 70) {
    verdict = 'needs_review';
  } else if (best.softCoveragePercent >= 50) {
    verdict = 'partial';
  } else {
    verdict = 'infeasible';
  }

  const riskFlags = [];

  // Special-case risk flags
  if (best.missing.length > 0 && verdict !== 'infeasible') {
    riskFlags.push(`${best.missing.length} item(s) not in any catalog image: ${best.missing.slice(0, 5).join(', ')}${best.missing.length > 5 ? '…' : ''}`);
  }
  // Check for things we know we can't do in containers regardless of image
  for (const r of requestedNorm) {
    if (r.includes('gpu') || r.includes('cuda')) {
      riskFlags.push('GPU requested — containers can use GPUs only with nvidia-docker on a GPU host. Verify host hardware before quoting.');
    }
    if (r.includes('windows') && !r.includes('windows subsystem')) {
      riskFlags.push('Windows software requested — Linux containers cannot run Windows binaries. Use the Windows RDS path instead.');
    }
    if (r.includes('mac') || r.includes('macos') || r.includes('osx')) {
      riskFlags.push('macOS software requested — not supported in any container.');
    }
  }

  return {
    verdict,
    bestMatch: best,
    alternatives,
    requestedSoftware: requestedNorm,
    requestedSoftwareRaw: requestedRaw,
    riskFlags,
  };
}

module.exports = { evaluateContainerFeasibility, scoreImage };
