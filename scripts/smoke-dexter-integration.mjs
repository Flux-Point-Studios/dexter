#!/usr/bin/env node
/**
 * Dexter Integration Smoke Test
 * 
 * Tests the full Dexter SDK flow as it would be used by ADAM:
 * 1. Initialize Dexter with shouldFallbackToApi=true
 * 2. Create fetch requests for specific DEXs
 * 3. Query liquidity pools with token filters
 * 4. Verify pool data integrity
 * 
 * Usage:
 *   bun scripts/smoke-dexter-integration.mjs
 *   DEXTER_LOG_LEVEL=debug bun scripts/smoke-dexter-integration.mjs
 */

import {
  Dexter,
  Asset,
  Minswap,
  SundaeSwapV1,
  SundaeSwapV3,
  MuesliSwap,
  WingRiders,
  VyFinance,
  Splash,
  SaturnSwapAMM,
} from '../build/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Colors
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color, ...args, COLORS.reset);
}

// ─────────────────────────────────────────────────────────────────────────────
// Well-known tokens
// ─────────────────────────────────────────────────────────────────────────────

const TOKENS = {
  // MIN token
  MIN: new Asset('29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6', '4d494e'),
  // SUNDAE token  
  SUNDAE: new Asset('9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d77', '53554e444145'),
  // SNEK token
  SNEK: new Asset('279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f', '534e454b'),
  // iUSD
  iUSD: new Asset('f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880', '69555344'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Cases
// ─────────────────────────────────────────────────────────────────────────────

async function testDexterConfig() {
  console.log('\n' + COLORS.bright + '🔧 Test: Dexter Configuration' + COLORS.reset);
  console.log(COLORS.dim + '─'.repeat(60) + COLORS.reset);

  const dexter = new Dexter(
    { shouldFallbackToApi: true, shouldFetchMetadata: false },
    { timeout: 15000, retries: 2 }
  );

  console.log(`  shouldFallbackToApi: ${dexter.config.shouldFallbackToApi ? COLORS.green + '✓ true' : COLORS.red + '✗ false'}${COLORS.reset}`);
  console.log(`  shouldFetchMetadata: ${!dexter.config.shouldFetchMetadata ? COLORS.green + '✓ false (disabled)' : COLORS.yellow + 'enabled'}${COLORS.reset}`);
  console.log(`  timeout: ${dexter.requestConfig.timeout}ms`);
  console.log(`  retries: ${dexter.requestConfig.retries}`);

  const dexCount = Object.keys(dexter.availableDexs).length;
  console.log(`  Available DEXs: ${dexCount}`);

  return { success: dexter.config.shouldFallbackToApi === true, dexCount };
}

async function testFetchRequestWithWorkingDex() {
  console.log('\n' + COLORS.bright + '📊 Test: FetchRequest with Working DEX (MuesliSwap)' + COLORS.reset);
  console.log(COLORS.dim + '─'.repeat(60) + COLORS.reset);

  const dexter = new Dexter(
    { shouldFallbackToApi: true, shouldFetchMetadata: false },
    { timeout: 15000, retries: 1 }
  );

  const startTime = Date.now();

  try {
    // Use MuesliSwap which we know works
    // forTokens expects an array of tokens
    const pools = await dexter.newFetchRequest()
      .onDexs([MuesliSwap.identifier])
      .forTokens(['lovelace'])
      .getLiquidityPools();

    const duration = Date.now() - startTime;

    console.log(`  ${COLORS.green}✓${COLORS.reset} Fetched ${pools.length} pools in ${duration}ms`);

    if (pools.length > 0) {
      const sample = pools[0];
      console.log(`  Sample pool:`);
      console.log(`    DEX: ${sample.dex}`);
      console.log(`    Identifier: ${sample.identifier?.substring(0, 30)}...`);
      console.log(`    Reserve A: ${sample.reserveA}`);
      console.log(`    Reserve B: ${sample.reserveB}`);
    }

    return { success: pools.length > 0, poolCount: pools.length, duration };
  } catch (e) {
    console.log(`  ${COLORS.red}✗${COLORS.reset} Error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function testFetchRequestWithMultipleDexs() {
  console.log('\n' + COLORS.bright + '📊 Test: FetchRequest with Multiple DEXs' + COLORS.reset);
  console.log(COLORS.dim + '─'.repeat(60) + COLORS.reset);

  const dexter = new Dexter(
    { shouldFallbackToApi: true, shouldFetchMetadata: false },
    { timeout: 30000, retries: 1 }
  );

  // Only use DEXs we know work for bulk queries
  const workingDexs = [
    MuesliSwap.identifier,
    VyFinance.identifier,
    Splash.identifier,
  ];

  const startTime = Date.now();

  try {
    // forTokens expects an array of tokens
    const pools = await dexter.newFetchRequest()
      .onDexs(workingDexs)
      .forTokens(['lovelace'])
      .getLiquidityPools();

    const duration = Date.now() - startTime;

    // Group by DEX
    const byDex = {};
    for (const pool of pools) {
      byDex[pool.dex] = (byDex[pool.dex] || 0) + 1;
    }

    console.log(`  ${COLORS.green}✓${COLORS.reset} Fetched ${pools.length} total pools in ${duration}ms`);
    console.log(`  Breakdown by DEX:`);
    for (const [dex, count] of Object.entries(byDex)) {
      console.log(`    ${dex}: ${count} pools`);
    }

    return { success: pools.length > 0, poolCount: pools.length, duration, byDex };
  } catch (e) {
    console.log(`  ${COLORS.red}✗${COLORS.reset} Error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function testFetchRequestWithPairFilter() {
  console.log('\n' + COLORS.bright + '📊 Test: FetchRequest with Pair Filter (ADA/SUNDAE)' + COLORS.reset);
  console.log(COLORS.dim + '─'.repeat(60) + COLORS.reset);

  const dexter = new Dexter(
    { shouldFallbackToApi: true, shouldFetchMetadata: false },
    { timeout: 30000, retries: 1 }
  );

  const startTime = Date.now();

  try {
    // This should work with SundaeSwap V3 which requires pair queries
    // forTokenPairs expects an array of [tokenA, tokenB] pairs
    const pools = await dexter.newFetchRequest()
      .onDexs([SundaeSwapV1.identifier, SundaeSwapV3.identifier])
      .forTokenPairs([['lovelace', TOKENS.SUNDAE]])
      .getLiquidityPools();

    const duration = Date.now() - startTime;

    console.log(`  ${COLORS.green}✓${COLORS.reset} Found ${pools.length} ADA/SUNDAE pools in ${duration}ms`);

    for (const pool of pools.slice(0, 3)) {
      console.log(`    ${pool.dex}: ${pool.identifier?.substring(0, 30)}...`);
    }

    return { success: true, poolCount: pools.length, duration };
  } catch (e) {
    console.log(`  ${COLORS.red}✗${COLORS.reset} Error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function testErrorRecovery() {
  console.log('\n' + COLORS.bright + '🛡️ Test: Error Recovery (Broken + Working DEXs)' + COLORS.reset);
  console.log(COLORS.dim + '─'.repeat(60) + COLORS.reset);

  const dexter = new Dexter(
    { shouldFallbackToApi: true, shouldFetchMetadata: false },
    { timeout: 15000, retries: 1 }
  );

  // Mix of working and broken DEXs - should not crash
  const mixedDexs = [
    Minswap.identifier,     // Broken (schema changed)
    MuesliSwap.identifier,  // Working
    WingRiders.identifier,  // Broken (schema changed)
    Splash.identifier,      // Working
  ];

  const startTime = Date.now();

  try {
    // forTokens expects an array of tokens
    const pools = await dexter.newFetchRequest()
      .onDexs(mixedDexs)
      .forTokens(['lovelace'])
      .getLiquidityPools();

    const duration = Date.now() - startTime;

    // Should still get pools from working DEXs
    const byDex = {};
    for (const pool of pools) {
      byDex[pool.dex] = (byDex[pool.dex] || 0) + 1;
    }

    console.log(`  ${COLORS.green}✓${COLORS.reset} Recovered gracefully - got ${pools.length} pools in ${duration}ms`);
    console.log(`  Working DEXs contributed:`);
    for (const [dex, count] of Object.entries(byDex)) {
      console.log(`    ${dex}: ${count} pools`);
    }

    // Success if we got pools from at least one working DEX
    const gotMuesli = byDex[MuesliSwap.identifier] > 0;
    const gotSplash = byDex[Splash.identifier] > 0;

    return { success: gotMuesli || gotSplash, poolCount: pools.length, duration };
  } catch (e) {
    console.log(`  ${COLORS.red}✗${COLORS.reset} Unexpected error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + COLORS.bright + '═'.repeat(60) + COLORS.reset);
  console.log(COLORS.cyan + COLORS.bright + '           Dexter Integration Smoke Test' + COLORS.reset);
  console.log(COLORS.bright + '═'.repeat(60) + COLORS.reset);

  const results = [];

  // Run tests
  results.push({ name: 'Config', ...await testDexterConfig() });
  results.push({ name: 'Single DEX', ...await testFetchRequestWithWorkingDex() });
  results.push({ name: 'Multiple DEXs', ...await testFetchRequestWithMultipleDexs() });
  results.push({ name: 'Pair Filter', ...await testFetchRequestWithPairFilter() });
  results.push({ name: 'Error Recovery', ...await testErrorRecovery() });

  // Summary
  console.log('\n' + COLORS.bright + '═'.repeat(60) + COLORS.reset);
  console.log(COLORS.cyan + COLORS.bright + '                      Summary' + COLORS.reset);
  console.log(COLORS.bright + '═'.repeat(60) + COLORS.reset + '\n');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  for (const r of results) {
    const icon = r.success ? COLORS.green + '✓' : COLORS.red + '✗';
    console.log(`  ${icon}${COLORS.reset} ${r.name}`);
  }

  console.log(`\n  ${COLORS.green}Passed:${COLORS.reset} ${passed}`);
  console.log(`  ${COLORS.red}Failed:${COLORS.reset} ${failed}`);
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(COLORS.red + 'Fatal error:' + COLORS.reset, e);
  process.exit(1);
});

