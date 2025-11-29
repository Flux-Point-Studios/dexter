import { Data } from '@lucid-evolution/lucid';

/**
 * Decode SaturnSwap's SwapDatum
 * 
 * SwapDatum structure:
 * - owner: Address
 * - policy_id_sell: ByteArray  
 * - asset_name_sell: ByteArray
 * - amount_sell: Int
 * - policy_id_buy: ByteArray
 * - asset_name_buy: ByteArray
 * - amount_buy: Int
 * - valid_before_time: Option<Int>
 * - output_reference: OutputReference
 */
export function decodeSwapDatum(datumCbor: string): any {
    try {
        const datum = Data.from(datumCbor) as any;
        
        // SwapDatum is a constructor with index 0
        if (datum.index !== 0) {
            throw new Error('Invalid SwapDatum constructor index');
        }
        
        const fields = datum.fields;
        if (!fields || fields.length !== 9) {
            throw new Error('Invalid SwapDatum fields');
        }
        
        // Parse Address (constructor with payment and stake credential)
        const owner = fields[0];
        
        // Parse sell token details
        const policy_id_sell = fields[1];
        const asset_name_sell = fields[2];
        const amount_sell = BigInt(fields[3]);
        
        // Parse buy token details
        const policy_id_buy = fields[4];
        const asset_name_buy = fields[5]; 
        const amount_buy = BigInt(fields[6]);
        
        // Parse optional expiry time
        const valid_before_time = fields[7];
        const expiry = valid_before_time.index === 0 ? BigInt(valid_before_time.fields[0]) : null;
        
        // Parse output reference
        const output_reference = fields[8];
        
        return {
            owner,
            sellToken: {
                policyId: policy_id_sell,
                assetName: asset_name_sell,
                amount: amount_sell
            },
            buyToken: {
                policyId: policy_id_buy,
                assetName: asset_name_buy,
                amount: amount_buy
            },
            expiry,
            outputReference: output_reference
        };
    } catch (error) {
        console.error('Failed to decode SwapDatum:', error);
        return null;
    }
}

/**
 * Decode SaturnSwap's ControlDatum (for liquidity/pool management)
 * 
 * ControlDatum structure:
 * - policy_id_one: ByteArray
 * - asset_name_one: ByteArray
 * - min_one_price: Int
 * - max_one_price: Int
 * - precision_one: Int
 * - policy_id_two: ByteArray
 * - asset_name_two: ByteArray
 * - min_two_price: Int
 * - max_two_price: Int
 * - precision_two: Int
 * - is_active: Bool
 */
export function decodeControlDatum(datumCbor: string): any {
    try {
        const datum = Data.from(datumCbor) as any;
        
        // ControlDatum is constructor index 2 in LiquidityDatum
        if (datum.index !== 2) {
            // Could be AddLiquidityDatum (0) or SignatureDatum (1)
            return null;
        }
        
        const fields = datum.fields;
        if (!fields || fields.length !== 11) {
            throw new Error('Invalid ControlDatum fields');
        }
        
        return {
            tokenOne: {
                policyId: fields[0],
                assetName: fields[1],
                minPrice: BigInt(fields[2]),
                maxPrice: BigInt(fields[3]),
                precision: BigInt(fields[4])
            },
            tokenTwo: {
                policyId: fields[5],
                assetName: fields[6],
                minPrice: BigInt(fields[7]),
                maxPrice: BigInt(fields[8]),
                precision: BigInt(fields[9])
            },
            isActive: fields[10].index === 1 // True constructor has index 1
        };
    } catch (error) {
        console.error('Failed to decode ControlDatum:', error);
        return null;
    }
}

/**
 * Check if a datum is a SwapDatum
 */
export function isSwapDatum(datumCbor: string): boolean {
    try {
        const datum = Data.from(datumCbor) as any;
        return datum.index === 0 && datum.fields?.length === 9;
    } catch {
        return false;
    }
}

/**
 * Check if a datum is a ControlDatum
 */
export function isControlDatum(datumCbor: string): boolean {
    try {
        const datum = Data.from(datumCbor) as any;
        return datum.index === 2 && datum.fields?.length === 11;
    } catch {
        return false;
    }
} 