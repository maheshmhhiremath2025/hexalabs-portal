const axios = require('axios');
const { getUsdToInr } = require('./exchangeRate');
const { logger } = require('../plugins/logger');

let priceCache = {};
let priceCacheTime = 0;
const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Fetch Azure Retail API pricing for a VM size in a region.
 * Returns { onDemand, spot } prices in USD.
 */
async function getVmPriceUsd(vmSize, region = 'southindia', os = 'linux') {
  const cacheKey = `${vmSize}-${region}-${os}`;
  if (priceCache[cacheKey] && Date.now() - priceCacheTime < CACHE_DURATION) {
    return priceCache[cacheKey];
  }

  try {
    const url = os === 'windows'
      ? `https://prices.azure.com/api/retail/prices?$filter=armRegionName eq '${region}' and armSkuName eq '${vmSize}' and priceType eq 'Consumption' and serviceFamily eq 'Compute' and contains(productName, 'Windows')`
      : `https://prices.azure.com/api/retail/prices?$filter=armRegionName eq '${region}' and armSkuName eq '${vmSize}' and priceType eq 'Consumption' and serviceFamily eq 'Compute'`;

    const res = await axios.get(url, { timeout: 10000 });
    let items = res.data.Items || [];

    // For Linux, filter out Windows results
    if (os !== 'windows') {
      items = items.filter(i => !i.productName.includes('Windows'));
    }

    const onDemand = items.find(i => !i.meterName.includes('Spot') && !i.meterName.includes('Low'))?.retailPrice || null;
    const spot = items.find(i => i.meterName.includes('Spot'))?.retailPrice || null;

    const result = { onDemand, spot };
    priceCache[cacheKey] = result;
    priceCacheTime = Date.now();
    return result;
  } catch (err) {
    logger.error(`Azure pricing fetch failed for ${vmSize}: ${err.message}`);
    return { onDemand: null, spot: null };
  }
}

/**
 * Get VM price in INR using live exchange rate.
 */
async function getVmPriceInr(vmSize, region = 'southindia', os = 'linux') {
  const usd = await getVmPriceUsd(vmSize, region, os);
  const rate = await getUsdToInr();
  return {
    onDemand: usd.onDemand ? Math.round(usd.onDemand * rate * 100) / 100 : null,
    spot: usd.spot ? Math.round(usd.spot * rate * 100) / 100 : null,
    exchangeRate: rate,
    currency: 'INR',
  };
}

/**
 * Get pricing for all common VM sizes (used by cost comparison APIs).
 * Returns a map of vmSize → { onDemandInr, spotInr }.
 */
async function getAllPricesInr(region = 'southindia') {
  const sizes = [
    { size: 'Standard_B1ms', os: 'linux' },
    { size: 'Standard_B2s', os: 'linux' },
    { size: 'Standard_B2s', os: 'windows' },
    { size: 'Standard_D4s_v3', os: 'linux' },
    { size: 'Standard_D4s_v3', os: 'windows' },
    { size: 'Standard_D8s_v3', os: 'linux' },
    { size: 'Standard_D8s_v3', os: 'windows' },
    { size: 'Standard_D16s_v3', os: 'linux' },
    { size: 'Standard_D16s_v3', os: 'windows' },
  ];

  const rate = await getUsdToInr();
  const result = {};

  for (const { size, os } of sizes) {
    const usd = await getVmPriceUsd(size, region, os);
    const key = `${size}-${os}`;
    result[key] = {
      vmSize: size,
      os,
      onDemandUsd: usd.onDemand,
      spotUsd: usd.spot,
      onDemandInr: usd.onDemand ? Math.round(usd.onDemand * rate * 100) / 100 : null,
      spotInr: usd.spot ? Math.round(usd.spot * rate * 100) / 100 : null,
    };
  }

  result.exchangeRate = rate;
  result.region = region;
  result.fetchedAt = new Date().toISOString();
  return result;
}

module.exports = { getVmPriceUsd, getVmPriceInr, getAllPricesInr };
