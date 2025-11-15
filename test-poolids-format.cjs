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
        const poolId = testPool.poolId || testPool.id;
        
        console.log(`Testing with pool: ${poolId}`);
        console.log(`Format: ${poolId.includes('-') ? 'Has hyphen (looks like policyId.assetName-lovelace)' : 'No hyphen'}`);
        console.log(`Length: ${poolId.length} chars\n`);

        // Try different formats
        const formats = [
            { name: 'Full poolId as-is', value: poolId },
            { name: 'Without -lovelace suffix', value: poolId.replace(/-lovelace$/, '') },
            { name: 'Just assetB part', value: testPool.assetB },
        ];

        for (const format of formats) {
            console.log(`Testing: ${format.name} = "${format.value}"`);
            try {
                const detailRes = await axios.get(
                    `${baseUrl}/v1/aggregator/pools/by-pool`,
                    { params: { id: format.value }, timeout: 5000 }
                );
                console.log(`  ✅ SUCCESS - Detail retrieved`);
                console.log(`     id: ${detailRes.data?.id}`);
                console.log(`     poolId: ${detailRes.data?.poolId}`);
                console.log(`     buildable: ${JSON.stringify(detailRes.data?.buildable)}`);
                break; // Found working format
            } catch (err) {
                const status = err.response?.status;
                const error = err.response?.data?.error || err.message;
                console.log(`  ❌ Failed: ${status || 'timeout'} - ${error}`);
            }
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

