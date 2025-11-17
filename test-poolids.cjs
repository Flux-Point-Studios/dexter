const axios = require('axios');

async function testPoolIds() {
    const baseUrl = 'https://api.saturnswap.io';
    const timeout = 15000;

    console.log('Testing SaturnSwap API poolId responses...\n');

    try {
        // Test 1: Get pools and check poolId field
        console.log('1. Testing GET /v1/aggregator/pools');
        const poolsRes = await axios.get(`${baseUrl}/v1/aggregator/pools`, {
            timeout,
            headers: { 'Content-Type': 'application/json' }
        });

        const pools = Array.isArray(poolsRes.data) ? poolsRes.data : (poolsRes.data?.pools || []);
        console.log(`   ✅ Got ${pools.length} pools`);

        if (pools.length === 0) {
            console.log('   ⚠️  No pools returned');
            return;
        }

        // Check first few pools
        const samples = pools.slice(0, 5);
        console.log('\n   Sample pools:');
        for (const pool of samples) {
            const hasId = !!pool.id;
            const hasPoolId = !!pool.poolId;
            const idsMatch = pool.id === pool.poolId;
            const looksFabricated = pool.id && pool.id.includes('-') && pool.id.includes('lovelace');

            console.log(`   - id: ${pool.id || 'MISSING'}`);
            console.log(`     poolId: ${pool.poolId || 'MISSING'}`);
            console.log(`     ids match: ${idsMatch ? '✅' : '❌'}`);
            console.log(`     looks fabricated: ${looksFabricated ? '⚠️  YES' : '✅ NO'}`);
            console.log(`     assetA: ${pool.assetA || 'MISSING'}`);
            console.log(`     assetB: ${pool.assetB || 'MISSING'}`);
            console.log('');
        }

        // Test 2: Try to use a poolId for a quote
        const testPool = pools.find(p => p.poolId && p.assetA && p.assetB);
        if (testPool) {
            console.log(`2. Testing POST /v1/aggregator/amm/quote with poolId: ${testPool.poolId}`);
            try {
                const quoteRes = await axios.post(
                    `${baseUrl}/v1/aggregator/amm/quote`,
                    {
                        poolId: testPool.poolId,
                        direction: 'in',
                        swapInAmount: 1_000_000, // 1 ADA in lovelace
                        slippageBps: 50
                    },
                    {
                        timeout,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
                console.log(`   ✅ Quote successful`);
                console.log(`   Expected out: ${quoteRes.data?.expectedOut || 'N/A'}`);
                console.log(`   Min receive: ${quoteRes.data?.minReceive || 'N/A'}`);
            } catch (quoteErr) {
                if (quoteErr.response) {
                    console.log(`   ❌ Quote failed: ${quoteErr.response.status} ${quoteErr.response.statusText}`);
                    console.log(`   Response: ${JSON.stringify(quoteErr.response.data)}`);
                } else {
                    console.log(`   ❌ Quote failed: ${quoteErr.message}`);
                }
            }
        } else {
            console.log('2. ⚠️  No suitable pool found for quote test');
        }

        // Test 3: Check pool detail endpoint using supported forms
        if (testPool?.poolId) {
            const pairKey = testPool.id; // backend: id is the legacy pair key
            let detail;

            console.log(`\n3. Testing by-pool with poolId (preferred): /v1/aggregator/pools/by-pool?poolId=${testPool.poolId}`);
            try {
                const res = await axios.get(`${baseUrl}/v1/aggregator/pools/by-pool`, {
                    params: { poolId: testPool.poolId, t: Date.now() },
                    timeout,
                    headers: { 'Content-Type': 'application/json' }
                });
                detail = res.data;
                console.log(`   ✅ Detail via ?poolId succeeded (x-correlation-id: ${res.headers?.['x-correlation-id'] || 'n/a'})`);
            } catch (e1) {
                console.log(`   ❌ ?poolId lookup failed: ${e1.response?.status || e1.message} (x-correlation-id: ${e1.response?.headers?.['x-correlation-id'] || 'n/a'})`);
            }

            if (!detail) {
                console.log(`   Trying by-pool with pair key id: /v1/aggregator/pools/by-pool?id=${pairKey}`);
                try {
                    const res = await axios.get(`${baseUrl}/v1/aggregator/pools/by-pool`, {
                        params: { id: pairKey, t: Date.now() },
                        timeout
                    });
                    detail = res.data;
                    console.log(`   ✅ Detail via ?id pair key succeeded (x-correlation-id: ${res.headers?.['x-correlation-id'] || 'n/a'})`);
                } catch (e2) {
                    console.log(`   ❌ ?id pair key lookup failed: ${e2.response?.status || e2.message} (x-correlation-id: ${e2.response?.headers?.['x-correlation-id'] || 'n/a'})`);
                }
            }

            if (!detail) {
                console.log(`   Trying path with UUID: /v1/aggregator/pools/${testPool.poolId}`);
                try {
                    const res = await axios.get(`${baseUrl}/v1/aggregator/pools/${testPool.poolId}`, { timeout, params: { t: Date.now() } });
                    detail = res.data;
                    console.log(`   ✅ Detail via path UUID succeeded (x-correlation-id: ${res.headers?.['x-correlation-id'] || 'n/a'})`);
                } catch (e3) {
                    console.log(`   ❌ Path UUID lookup failed: ${e3.response?.status || e3.message} (x-correlation-id: ${e3.response?.headers?.['x-correlation-id'] || 'n/a'})`);
                }
            }

            if (!detail) {
                console.log(`   Trying path with pair key: /v1/aggregator/pools/${pairKey}`);
                try {
                    const res = await axios.get(`${baseUrl}/v1/aggregator/pools/${pairKey}`, { timeout, params: { t: Date.now() } });
                    detail = res.data;
                    console.log(`   ✅ Detail via path pair key succeeded (x-correlation-id: ${res.headers?.['x-correlation-id'] || 'n/a'})`);
                } catch (e4) {
                    console.log(`   ❌ Path pair key lookup failed: ${e4.response?.status || e4.message} (x-correlation-id: ${e4.response?.headers?.['x-correlation-id'] || 'n/a'})`);
                }
            }

            if (detail) {
                console.log(`   id: ${detail?.id || 'MISSING'}`);
                console.log(`   poolId: ${detail?.poolId || 'MISSING'}`);
                console.log(`   buildableFromAda: ${detail?.buildableFromAda}`);
                console.log(`   buildableFromToken: ${detail?.buildableFromToken}`);
                console.log(`   bestBid: ${detail?.bestBid}`);
                console.log(`   bestAsk: ${detail?.bestAsk}`);
            } else {
                console.log(`   ❌ Pool detail failed for all accepted forms`);
            }
        }

        // Summary
        console.log('\n📊 Summary:');
        const allHavePoolId = pools.every(p => p.poolId);
        const allIdsMatch = pools.every(p => p.id === p.poolId);
        const anyFabricated = pools.some(p => p.id && p.id.includes('-') && p.id.includes('lovelace'));

        console.log(`   All pools have poolId: ${allHavePoolId ? '✅' : '❌'}`);
        console.log(`   All ids match poolIds: ${allIdsMatch ? '✅' : '❌'}`);
        console.log(`   Any look fabricated: ${anyFabricated ? '⚠️  YES' : '✅ NO'}`);

    } catch (error) {
        console.log(`❌ Test failed: ${error.message}`);
        if (error.response) {
            console.log(`   Status: ${error.response.status} ${error.response.statusText}`);
            console.log(`   Data: ${JSON.stringify(error.response.data)}`);
        }
        process.exit(1);
    }
}

testPoolIds().then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
}).catch(err => {
    console.error('\n❌ Test error:', err);
    process.exit(1);
});

