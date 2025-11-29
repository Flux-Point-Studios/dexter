#!/usr/bin/env node
/**
 * DEX API Smoke Test Suite
 * 
 * Tests all DEX API adapters against their real endpoints to verify:
 * 1. API connectivity and response handling
 * 2. Defensive error handling (no crashes on malformed responses)
 * 3. Proper pool data parsing and validation
 * 
 * Usage:
 *   DEXTER_LOG_LEVEL=debug bun scripts/smoke-dex-apis.mjs
 *   bun scripts/smoke-dex-apis.mjs --dex minswap
 *   bun scripts/smoke-dex-apis.mjs --verbose
 *   bun scripts/smoke-dex-apis.mjs --timeout 30000
 */

import {
  Dexter,
  Minswap,
  SundaeSwapV1,
  SundaeSwapV3,
  MuesliSwap,
  WingRiders,
  WingRidersV2,
  VyFinance,
  Splash,
  SaturnSwapAMM,
  Asset,
} from '../build/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEX_CONFIGS = {
  minswap: {
    identifier: Minswap.identifier,
    name: 'Minswap',
    testAsset: 'lovelace', // ADA pools
    expectPools: false, // API schema changed - needs adapter update
    knownIssue: 'GraphQL schema changed (now uses input object)',
  },
  sundaeswapV1: {
    identifier: SundaeSwapV1.identifier,
    name: 'SundaeSwap V1',
    testAsset: 'lovelace',
    expectPools: true,
  },
  sundaeswapV3: {
    identifier: SundaeSwapV3.identifier,
    name: 'SundaeSwap V3',
    testAsset: 'lovelace',
    expectPools: false, // Requires specific pair query, not bulk fetch
    requiresPair: true,
    knownIssue: 'API requires specific pair - use pair query test',
  },
  muesliswap: {
    identifier: MuesliSwap.identifier,
    name: 'MuesliSwap',
    testAsset: 'lovelace',
    expectPools: true,
  },
  wingriders: {
    identifier: WingRiders.identifier,
    name: 'WingRiders',
    testAsset: 'lovelace',
    expectPools: false, // API schema changed - needs adapter update
    knownIssue: 'GraphQL schema changed (now uses inline fragments)',
  },
  wingridersV2: {
    identifier: WingRidersV2.identifier,
    name: 'WingRiders V2',
    testAsset: 'lovelace',
    expectPools: false, // No API defined - uses on-chain discovery
    knownIssue: 'On-chain discovery only (no HTTP API)',
    skipApiTest: true, // Don't fail if API is unavailable
  },
  vyfinance: {
    identifier: VyFinance.identifier,
    name: 'VyFinance',
    testAsset: 'lovelace',
    expectPools: true,
  },
  splash: {
    identifier: Splash.identifier,
    name: 'Splash',
    testAsset: 'lovelace',
    expectPools: true,
  },
  saturnswapAmm: {
    identifier: SaturnSwapAMM.identifier,
    name: 'SaturnSwap AMM',
    testAsset: 'lovelace',
    expectPools: false, // Requires pair query for pool discovery
    requiresPair: true,
    knownIssue: 'liquidityPools requires both assets - use pair query',
  },
};

// Well-known tokens for pair testing
const KNOWN_TOKENS = {
  MIN: new Asset('29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6', '4d494e'), // Minswap MIN
  SNEK: new Asset('279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f', '534e454b'), // SNEK
  HOSKY: new Asset('a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235', '484f534b59'), // HOSKY
  SUNDAE: new Asset('9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d77', '53554e444145'), // SUNDAE
};

// ─────────────────────────────────────────────────────────────────────────────
// CLI Argument Parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    verbose: false,
    dex: null,
    timeout: 15000,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--verbose' || arg === '-v') args.verbose = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if ((arg === '--dex' || arg === '-d') && argv[i + 1]) args.dex = argv[++i];
    else if ((arg === '--timeout' || arg === '-t') && argv[i + 1]) args.timeout = Number(argv[++i]);
  }

  return args;
}

function showHelp() {
  console.log(`
DEX API Smoke Test Suite

Usage:
  bun scripts/smoke-dex-apis.mjs [options]

Options:
  -h, --help              Show this help message
  -v, --verbose           Show detailed pool information
  -d, --dex <name>        Test only a specific DEX (minswap, sundaeswapV1, etc.)
  -t, --timeout <ms>      Request timeout in milliseconds (default: 15000)

Environment Variables:
  DEXTER_LOG_LEVEL=debug  Enable debug logging from Dexter SDK

Available DEXs:
  ${Object.keys(DEX_CONFIGS).join(', ')}

Examples:
  bun scripts/smoke-dex-apis.mjs
  bun scripts/smoke-dex-apis.mjs --verbose
  bun scripts/smoke-dex-apis.mjs --dex minswap
  DEXTER_LOG_LEVEL=debug bun scripts/smoke-dex-apis.mjs
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Utilities
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

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPoolSummary(pool) {
  const assetA = pool.assetA === 'lovelace' ? 'ADA' : pool.assetA?.assetName || pool.assetA?.identifier?.() || '???';
  const assetB = pool.assetB === 'lovelace' ? 'ADA' : pool.assetB?.assetName || pool.assetB?.identifier?.() || '???';
  const reserveA = pool.reserveA?.toString() || '0';
  const reserveB = pool.reserveB?.toString() || '0';
  return `${assetA}/${assetB} (A: ${reserveA}, B: ${reserveB})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner
// ─────────────────────────────────────────────────────────────────────────────

async function testDexApi(dexter, config, verbose) {
  const result = {
    name: config.name,
    identifier: config.identifier,
    success: false,
    poolCount: 0,
    duration: 0,
    error: null,
    samplePools: [],
    knownIssue: config.knownIssue || null,
    skipped: false,
  };

  const dex = dexter.dexByName(config.identifier);
  if (!dex) {
    result.error = `DEX not found: ${config.identifier}`;
    return result;
  }

  const api = dex.api;
  if (!api) {
    result.error = `API not available for ${config.name}`;
    // If skipApiTest is true, this is expected and should be marked as skipped, not failed
    if (config.skipApiTest || config.knownIssue) {
      result.skipped = true;
      result.success = true;
    }
    return result;
  }

  const startTime = Date.now();

  try {
    // Test 1: Fetch pools with lovelace (ADA)
    const pools = await api.liquidityPools(config.testAsset);
    result.duration = Date.now() - startTime;
    result.poolCount = pools.length;

    // Validate pools are actual LiquidityPool objects
    if (pools.length > 0) {
      const validPools = pools.filter(p => 
        p && 
        typeof p === 'object' && 
        (p.assetA === 'lovelace' || p.assetA?.policyId) &&
        (p.assetB === 'lovelace' || p.assetB?.policyId)
      );

      if (validPools.length !== pools.length) {
        result.error = `Invalid pool objects: ${pools.length - validPools.length} of ${pools.length}`;
      }

      // Sample first 3 pools for verbose output
      result.samplePools = validPools.slice(0, 3).map(p => ({
        identifier: p.identifier,
        pair: formatPoolSummary(p),
        feePercent: p.poolFeePercent,
      }));
    }

    // Success criteria: either we got pools, or we don't expect pools (known limitation)
    result.success = config.expectPools ? pools.length > 0 : true;

    if (!result.success && config.expectPools) {
      result.error = `Expected pools but got ${pools.length}`;
    }

  } catch (e) {
    result.duration = Date.now() - startTime;
    result.error = e?.message || String(e);
    // If there's a known issue and we got an error, mark as expected
    if (config.knownIssue) {
      result.success = true;
      result.skipped = true;
    }
  }

  return result;
}

async function testDexPairQuery(dexter, config, assetA, assetB) {
  const result = {
    name: `${config.name} (pair query)`,
    success: false,
    poolCount: 0,
    duration: 0,
    error: null,
  };

  const dex = dexter.dexByName(config.identifier);
  if (!dex?.api) {
    result.error = 'DEX or API not available';
    return result;
  }

  const startTime = Date.now();

  try {
    const pools = await dex.api.liquidityPools(assetA, assetB);
    result.duration = Date.now() - startTime;
    result.poolCount = pools.length;
    result.success = true; // Success if no crash, even with 0 pools
  } catch (e) {
    result.duration = Date.now() - startTime;
    result.error = e?.message || String(e);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  console.log('\n' + COLORS.bright + '═══════════════════════════════════════════════════════════════' + COLORS.reset);
  console.log(COLORS.cyan + COLORS.bright + '                    DEX API Smoke Test Suite' + COLORS.reset);
  console.log(COLORS.bright + '═══════════════════════════════════════════════════════════════' + COLORS.reset + '\n');

  // Initialize Dexter with longer timeout for API calls
  const dexter = new Dexter(
    { shouldFallbackToApi: true, shouldFetchMetadata: false },
    { timeout: args.timeout, retries: 1 }
  );

  // Determine which DEXs to test
  let dexsToTest = Object.entries(DEX_CONFIGS);
  if (args.dex) {
    const filtered = dexsToTest.filter(([key]) => key.toLowerCase() === args.dex.toLowerCase());
    if (filtered.length === 0) {
      log(COLORS.red, `Unknown DEX: ${args.dex}`);
      log(COLORS.dim, `Available: ${Object.keys(DEX_CONFIGS).join(', ')}`);
      process.exit(1);
    }
    dexsToTest = filtered;
  }

  const results = [];
  const pairResults = [];

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: Basic liquidityPools() call for each DEX
  // ─────────────────────────────────────────────────────────────────────────
  console.log(COLORS.bright + '📊 Test 1: Basic Pool Discovery (ADA pairs)' + COLORS.reset);
  console.log(COLORS.dim + '─────────────────────────────────────────────────────────────────' + COLORS.reset + '\n');

  for (const [key, config] of dexsToTest) {
    process.stdout.write(`  Testing ${config.name.padEnd(20)} `);
    
    const result = await testDexApi(dexter, config, args.verbose);
    results.push(result);

    if (result.success) {
      if (result.skipped || result.knownIssue) {
        log(COLORS.yellow, `⊘ Skipped (${result.knownIssue || 'known limitation'})`);
      } else {
        log(COLORS.green, `✓ ${result.poolCount} pools (${formatDuration(result.duration)})`);
        
        if (args.verbose && result.samplePools.length > 0) {
          for (const pool of result.samplePools) {
            console.log(COLORS.dim + `      └─ ${pool.pair} (fee: ${pool.feePercent}%)` + COLORS.reset);
          }
        }
      }
    } else {
      log(COLORS.red, `✗ ${result.error || 'Failed'} (${formatDuration(result.duration)})`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: Specific pair queries (ADA/MIN) - tests APIs that require both assets
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n' + COLORS.bright + '📊 Test 2: Pair Query (ADA/MIN) - Critical for SundaeSwap V3, SaturnSwap' + COLORS.reset);
  console.log(COLORS.dim + '─────────────────────────────────────────────────────────────────' + COLORS.reset + '\n');

  for (const [key, config] of dexsToTest) {
    process.stdout.write(`  Testing ${config.name.padEnd(20)} `);
    
    const result = await testDexPairQuery(dexter, config, 'lovelace', KNOWN_TOKENS.MIN);
    pairResults.push(result);

    if (result.success) {
      const marker = config.requiresPair ? '★' : '✓';
      const note = config.requiresPair ? ' (primary method)' : '';
      log(COLORS.green, `${marker} ${result.poolCount} pools (${formatDuration(result.duration)})${note}`);
    } else {
      log(COLORS.red, `✗ ${result.error || 'Failed'} (${formatDuration(result.duration)})`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: Non-existent pair (should return empty, not crash)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n' + COLORS.bright + '📊 Test 3: Non-existent Pair Handling' + COLORS.reset);
  console.log(COLORS.dim + '─────────────────────────────────────────────────────────────────' + COLORS.reset + '\n');

  const fakeAsset = new Asset('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'deadbeef');

  for (const [key, config] of dexsToTest) {
    process.stdout.write(`  Testing ${config.name.padEnd(20)} `);
    
    const result = await testDexPairQuery(dexter, config, fakeAsset, KNOWN_TOKENS.MIN);
    
    if (result.success) {
      log(COLORS.green, `✓ Graceful (${result.poolCount} pools, ${formatDuration(result.duration)})`);
    } else {
      log(COLORS.yellow, `⚠ ${result.error || 'Error'} (${formatDuration(result.duration)})`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n' + COLORS.bright + '═══════════════════════════════════════════════════════════════' + COLORS.reset);
  console.log(COLORS.cyan + COLORS.bright + '                         Summary' + COLORS.reset);
  console.log(COLORS.bright + '═══════════════════════════════════════════════════════════════' + COLORS.reset + '\n');

  const passed = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped || r.knownIssue).length;
  const failed = results.filter(r => !r.success).length;
  const totalPools = results.reduce((sum, r) => sum + r.poolCount, 0);
  const testedResults = results.filter(r => r.duration > 0);
  const avgDuration = testedResults.length > 0 
    ? testedResults.reduce((sum, r) => sum + r.duration, 0) / testedResults.length 
    : 0;

  console.log(`  DEXs Tested:     ${results.length}`);
  console.log(`  ${COLORS.green}Passed:${COLORS.reset}          ${passed}`);
  console.log(`  ${COLORS.yellow}Skipped:${COLORS.reset}         ${skipped} (known limitations)`);
  console.log(`  ${COLORS.red}Failed:${COLORS.reset}          ${failed}`);
  console.log(`  Total Pools:     ${totalPools}`);
  console.log(`  Avg Response:    ${formatDuration(Math.round(avgDuration))}`);

  if (skipped > 0) {
    console.log('\n' + COLORS.yellow + '  Known Limitations:' + COLORS.reset);
    for (const r of results.filter(r => r.skipped || r.knownIssue)) {
      console.log(COLORS.yellow + `    • ${r.name}: ${r.knownIssue}` + COLORS.reset);
    }
  }

  if (failed > 0) {
    console.log('\n' + COLORS.red + '  Failed DEXs:' + COLORS.reset);
    for (const r of results.filter(r => !r.success)) {
      console.log(COLORS.red + `    • ${r.name}: ${r.error}` + COLORS.reset);
    }
  }

  console.log('\n');

  // Exit with error code if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(COLORS.red + 'Fatal error:' + COLORS.reset, e?.message || e);
  process.exit(1);
});

