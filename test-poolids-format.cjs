const axios = require('axios');

async function testPoolIdFormats() {
    const baseUrl = 'https://api.saturnswap.io';
    const timeout = 15000;

    console.log('Testing different poolId formats...\n');

    try {
        // Get pools
        const poolsRes = await axios.get(`${baseUrl}/v1/aggregator/pools`, { timeout });
        const pools = Array.isArray(poolsRes.data) ? poolsRes.data : (poolsRes.data?.pools || []);
        
        if (pools.length === 0) {
            console.log('No pools found');
            return;
        }

        const testPool = pools[0];
        const uuid = testPool.poolId;
        const pairKey = testPool.id; // backend: id pair key (e.g., <policy>.<asset>-lovelace)

        console.log(`Testing with UUID: ${uuid}`);
        console.log(`Pair key: ${pairKey}\n`);

        // Valid forms per spec
        const validForms = [
            { name: 'Query ?poolId (preferred)', type: 'query', params: { poolId: uuid, t: Date.now() } },
            { name: 'Query ?id (pair key)', type: 'query', params: { id: pairKey, t: Date.now() } },
            { name: 'Path /pools/<uuid>', type: 'path', value: uuid },
            { name: 'Path /pools/<pair key>', type: 'path', value: pairKey },
        ];

        for (const form of validForms) {
            try {
                if (form.type === 'query') {
                    console.log(`Testing: ${form.name}`);
                    const res = await axios.get(`${baseUrl}/v1/aggregator/pools/by-pool`, { params: form.params, timeout: 5000 });
                    console.log(`  ✅ SUCCESS (x-correlation-id: ${res.headers?.['x-correlation-id'] || 'n/a'})`);
                    console.log(`     id: ${res.data?.id}`);
                    console.log(`     poolId: ${res.data?.poolId}`);
                    console.log(`     buildableFromAda: ${res.data?.buildableFromAda}`);
                    console.log(`     buildableFromToken: ${res.data?.buildableFromToken}`);
                } else {
                    console.log(`Testing: ${form.name}`);
                    const res = await axios.get(`${baseUrl}/v1/aggregator/pools/${form.value}`, { timeout: 5000, params: { t: Date.now() } });
                    console.log(`  ✅ SUCCESS (x-correlation-id: ${res.headers?.['x-correlation-id'] || 'n/a'})`);
                    console.log(`     id: ${res.data?.id}`);
                    console.log(`     poolId: ${res.data?.poolId}`);
                    console.log(`     buildableFromAda: ${res.data?.buildableFromAda}`);
                    console.log(`     buildableFromToken: ${res.data?.buildableFromToken}`);
                }
            } catch (err) {
                console.log(`  ❌ Failed: ${err.response?.status || 'timeout'} - ${err.response?.data?.error || err.message} (x-correlation-id: ${err.response?.headers?.['x-correlation-id'] || 'n/a'})`);
            }
        }

        // Negative: asset-only strings are not accepted for poolId
        console.log(`\nNegative test (asset-only should fail for poolId): ${testPool.assetB}`);
        try {
            await axios.get(`${baseUrl}/v1/aggregator/pools/by-pool`, { params: { poolId: testPool.assetB, t: Date.now() }, timeout: 5000 });
            console.log(`  ⚠️ Unexpected success with asset-only as poolId`);
        } catch (err) {
            console.log(`  ✅ Rejected as expected: ${err.response?.status || 'timeout'} (x-correlation-id: ${err.response?.headers?.['x-correlation-id'] || 'n/a'})`);
        }

        // Also check if maybe we need to look at /assets endpoint
        console.log(`\nChecking /v1/aggregator/assets for poolId format...`);
        try {
            const assetsRes = await axios.get(`${baseUrl}/v1/aggregator/assets`, { timeout });
            const assets = assetsRes.data?.assets || [];
            if (assets.length > 0) {
                const sample = assets[0];
                console.log(`  Sample asset:`);
                console.log(`    poolId: ${sample.poolId}`);
                console.log(`    policyId: ${sample.policyId}`);
                console.log(`    assetName: ${sample.assetName}`);
                console.log(`    Format: ${sample.poolId?.includes('-') ? 'Has hyphen' : 'No hyphen'}`);
            }
        } catch (err) {
            console.log(`  ❌ Assets endpoint failed: ${err.message}`);
        }

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        process.exit(1);
    }
}

testPoolIdFormats().then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
}).catch(err => {
    console.error('❌ Test error:', err);
    process.exit(1);
});

