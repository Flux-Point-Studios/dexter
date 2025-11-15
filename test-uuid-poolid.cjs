const axios = require('axios');

async function testUuidPoolIds() {
    const baseUrl = 'https://api.saturnswap.io';
    const timeout = 15000;

    console.log('Testing UUID format poolIds from /assets endpoint...\n');

    try {
        // Get assets (which have UUID poolIds)
        const assetsRes = await axios.get(`${baseUrl}/v1/aggregator/assets`, { timeout });
        const assets = assetsRes.data?.assets || [];
        console.log(`Got ${assets.length} assets\n`);

        // Test first few with UUID poolIds
        for (let i = 0; i < Math.min(3, assets.length); i++) {
            const asset = assets[i];
            const uuidPoolId = asset.poolId;
            
            if (!uuidPoolId) continue;

            console.log(`Asset ${i + 1}:`);
            console.log(`  policyId: ${asset.policyId}`);
            console.log(`  assetName: ${asset.assetName}`);
            console.log(`  poolId (UUID): ${uuidPoolId}`);
            console.log(`  Format: ${uuidPoolId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? '✅ Valid UUID' : '❌ Not UUID'}`);

            // Try pool detail with UUID
            try {
                const detailRes = await axios.get(
                    `${baseUrl}/v1/aggregator/pools/by-pool`,
                    { params: { id: uuidPoolId }, timeout: 5000 }
                );
                console.log(`  ✅ Pool detail SUCCESS`);
                console.log(`     id: ${detailRes.data?.id}`);
                console.log(`     poolId: ${detailRes.data?.poolId}`);
                console.log(`     buildable: ${JSON.stringify(detailRes.data?.buildable)}`);

                // Try quote with UUID
                if (detailRes.data?.buildable?.marketBuyFromAda) {
                    try {
                        const quoteRes = await axios.post(
                            `${baseUrl}/v1/aggregator/amm/quote`,
                            {
                                poolId: uuidPoolId,
                                direction: 'in',
                                swapInAmount: 1_000_000,
                                slippageBps: 50
                            },
                            { timeout: 5000 }
                        );
                        console.log(`     ✅ Quote SUCCESS: expectedOut=${quoteRes.data?.expectedOut}`);
                    } catch (quoteErr) {
                        console.log(`     ❌ Quote failed: ${quoteErr.response?.status} ${quoteErr.response?.data?.error || quoteErr.message}`);
                    }
                }
            } catch (detailErr) {
                console.log(`  ❌ Pool detail failed: ${detailErr.response?.status} ${detailErr.response?.data?.error || detailErr.message}`);
            }
            console.log('');
        }

        // Check if pools endpoint has matching UUIDs
        console.log('Checking if /pools endpoint has matching UUIDs...\n');
        const poolsRes = await axios.get(`${baseUrl}/v1/aggregator/pools`, { timeout });
        const pools = Array.isArray(poolsRes.data) ? poolsRes.data : (poolsRes.data?.pools || []);
        
        // Try to find a pool that matches an asset
        const testAsset = assets.find(a => a.poolId);
        if (testAsset) {
            const matchingPool = pools.find(p => 
                p.assetB === `${testAsset.policyId}.${testAsset.assetName}` ||
                p.assetA === `${testAsset.policyId}.${testAsset.assetName}`
            );
            if (matchingPool) {
                console.log(`Found matching pool:`);
                console.log(`  Pool id: ${matchingPool.id}`);
                console.log(`  Pool poolId: ${matchingPool.poolId}`);
                console.log(`  Asset poolId (UUID): ${testAsset.poolId}`);
                console.log(`  Match: ${matchingPool.poolId === testAsset.poolId || matchingPool.id === testAsset.poolId ? '✅' : '❌ NO MATCH'}`);
            }
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

testUuidPoolIds().then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
}).catch(err => {
    console.error('❌ Test error:', err);
    process.exit(1);
});

