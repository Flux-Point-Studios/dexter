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

        // Test 3: Check pool detail endpoint
        if (testPool?.poolId) {
            console.log(`\n3. Testing GET /v1/aggregator/pools/by-pool?id=${testPool.poolId}`);
            try {
                const detailRes = await axios.get(
                    `${baseUrl}/v1/aggregator/pools/by-pool`,
                    {
                        params: { id: testPool.poolId },
                        timeout,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
                console.log(`   ✅ Pool detail successful`);
                console.log(`   id: ${detailRes.data?.id || 'MISSING'}`);
                console.log(`   poolId: ${detailRes.data?.poolId || 'MISSING'}`);
                console.log(`   ids match: ${detailRes.data?.id === detailRes.data?.poolId ? '✅' : '❌'}`);
            } catch (detailErr) {
                if (detailErr.response) {
                    console.log(`   ❌ Pool detail failed: ${detailErr.response.status} ${detailErr.response.statusText}`);
                } else {
                    console.log(`   ❌ Pool detail failed: ${detailErr.message}`);
                }
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

