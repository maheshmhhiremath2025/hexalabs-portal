const axios = require('axios');
const { logger } = require('../plugins/logger');

let cachedRate = 85; // fallback
let lastFetched = 0;
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Get live USD to INR exchange rate.
 * Cached for 6 hours. Falls back to last known rate on error.
 */
async function getUsdToInr() {
  if (Date.now() - lastFetched < CACHE_DURATION) return cachedRate;

  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 5000 });
    cachedRate = res.data.rates?.INR || cachedRate;
    lastFetched = Date.now();
    logger.info(`Exchange rate updated: 1 USD = ₹${cachedRate}`);
  } catch (err) {
    logger.error(`Exchange rate fetch failed, using cached: ₹${cachedRate} — ${err.message}`);
  }

  return cachedRate;
}

/**
 * Convert USD to INR using live rate.
 */
async function usdToInr(usd) {
  const rate = await getUsdToInr();
  return Math.round(usd * rate * 100) / 100;
}

module.exports = { getUsdToInr, usdToInr };
