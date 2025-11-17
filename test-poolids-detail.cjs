const axios = require('axios');

async function testPoolDetails() {
    const baseUrl = 'https://api.saturnswap.io';
    const timeout = 15000;

    console.log('Testing pool details and buildability...\n');

    try {
        // Get pools
        const poolsRes = await axios.get(`${baseUrl}/v1/aggregator/pools`, { timeout });
        const pools = Array.isArray(poolsRes.data) ? poolsRes.data : (poolsRes.data?.pools || []);
        console.log(`Got ${pools.length} pools\n`);

        // Test first 3 pools for detail and buildability
        for (let i = 0; i < Math.min(3, pools.length); i++) {
            const pool = pools[i];
            console.log(`Pool ${i + 1}: ${pool.id}`);
            console.log(`  assetA: ${pool.assetA}, assetB: ${pool.assetB}`);

            // Get pool detail
            try {
                const pairKey = pool.id; // backend: id is the legacy pair key
                let detail;

                // Preferred: poolId query
                try {
                    const viaPoolId = await axios.get(`${baseUrl}/v1/aggregator/pools/by-pool`, { params: { poolId: pool.poolId, t: Date.now() }, timeout });
                    detail = viaPoolId.data;
                    console.log(`  ✅ Detail retrieved (?poolId) (x-correlation-id: ${viaPoolId.headers?.['x-correlation-id'] || 'n/a'})`);
                } catch (e1) {
                    console.log(`  ❌ Detail (?poolId) failed: ${e1.response?.status || e1.message} (x-correlation-id: ${e1.response?.headers?.['x-correlation-id'] || 'n/a'})`);
                }

                // Fallback: id pair key query
                if (!detail) {
                    try {
                        const viaId = await axios.get(`${baseUrl}/v1/aggregator/pools/by-pool`, { params: { id: pairKey, t: Date.now() }, timeout });
                        detail = viaId.data;
                        console.log(`  ✅ Detail retrieved (?id pair key) (x-correlation-id: ${viaId.headers?.['x-correlation-id'] || 'n/a'})`);
                    } catch (e2) {
                        console.log(`  ❌ Detail (?id pair key) failed: ${e2.response?.status || e2.message} (x-correlation-id: ${e2.response?.headers?.['x-correlation-id'] || 'n/a'})`);
                    }
                }

                // Fallback: path UUID
                if (!detail) {
                    try {
                        const viaPathUuid = await axios.get(`${baseUrl}/v1/aggregator/pools/${pool.poolId}`, { timeout, params: { t: Date.now() } });
                        detail = viaPathUuid.data;
                        console.log(`  ✅ Detail retrieved (path UUID) (x-correlation-id: ${viaPathUuid.headers?.['x-correlation-id'] || 'n/a'})`);
                    } catch (e3) {
                        console.log(`  ❌ Detail (path UUID) failed: ${e3.response?.status || e3.message} (x-correlation-id: ${e3.response?.headers?.['x-correlation-id'] || 'n/a'})`);
                    }
                }

                // Fallback: path pair key
                if (!detail) {
                    try {
                        const viaPathPair = await axios.get(`${baseUrl}/v1/aggregator/pools/${pairKey}`, { timeout, params: { t: Date.now() } });
                        detail = viaPathPair.data;
                        console.log(`  ✅ Detail retrieved (path pair key) (x-correlation-id: ${viaPathPair.headers?.['x-correlation-id'] || 'n/a'})`);
                    } catch (e4) {
                        console.log(`  ❌ Detail (path pair key) failed: ${e4.response?.status || e4.message} (x-correlation-id: ${e4.response?.headers?.['x-correlation-id'] || 'n/a'})`);
                    }
                }

                if (!detail) {
                    throw new Error('All detail forms failed');
                }

                console.log(`     id: ${detail.id}`);
                console.log(`     poolId: ${detail.poolId}`);
                console.log(`     buildableFromAda: ${detail.buildableFromAda}`);
                console.log(`     buildableFromToken: ${detail.buildableFromToken}`);
                console.log(`     bestBid: ${detail.bestBid}`);
                console.log(`     bestAsk: ${detail.bestAsk}`);

                // Try quote if buildable
                if (detail.buildableFromAda) {
                    console.log(`  Testing quote (buildableFromAda=true)...`);
                    try {
                        const quoteRes = await axios.post(
                            `${baseUrl}/v1/aggregator/amm/quote`,
                            {
                                poolId: detail.poolId || detail.id,
                                direction: 'in',
                                swapInAmount: 1_000_000,
                                slippageBps: 50
                            },
                            { timeout }
                        );
                        console.log(`     ✅ Quote successful: expectedOut=${quoteRes.data?.expectedOut}, minReceive=${quoteRes.data?.minReceive} (x-correlation-id: ${quoteRes.headers?.['x-correlation-id'] || 'n/a'})`);
                    } catch (quoteErr) {
                        console.log(`     ❌ Quote failed: ${quoteErr.response?.status} ${quoteErr.response?.data?.error || quoteErr.message} (x-correlation-id: ${quoteErr.response?.headers?.['x-correlation-id'] || 'n/a'})`);
                    }
                } else {
                    console.log(`  ⚠️  Pool not buildableFromAda`);
                }
            } catch (detailErr) {
                console.log(`  ❌ Detail failed: ${detailErr.response?.status} ${detailErr.response?.data?.error || detailErr.message}`);
            }
            console.log('');
        }

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data: ${JSON.stringify(error.response.data)}`);
        }
        process.exit(1);
    }
}

testPoolDetails().then(() => {
    console.log('✅ Test complete');
    process.exit(0);
}).catch(err => {
    console.error('❌ Test error:', err);
    process.exit(1);
});

