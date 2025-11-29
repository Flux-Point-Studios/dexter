import type { BlockfrostConfig } from '@app/types';

type ResolvedBlockfrost = {
	url: string;
	projectId: string;
};

/**
 * Resolve Blockfrost config strictly from environment variables.
 * Prefers proxy if both env vars are present; otherwise falls back to direct credentials.
 */
export function resolveBlockfrostConfigFromEnv(): ResolvedBlockfrost {
	const proxyUrl = process.env.BLOCKFROST_PROXY_URL;
	const proxyAlias = process.env.BLOCKFROST_PROXY_PROJECT_ID;
	const directUrl =
		process.env.BLOCKFROST_URL ?? 'https://cardano-mainnet.blockfrost.io/api/v0';
	const directKey = process.env.BLOCKFROST_PROJECT_ID;

	if (proxyUrl && proxyAlias) {
		return { url: proxyUrl, projectId: proxyAlias };
	}

	if (!directKey) {
		throw new Error(
			'BLOCKFROST_PROJECT_ID is required when proxy is not configured'
		);
	}

	return { url: directUrl, projectId: directKey };
}

/**
 * Resolve Blockfrost config, preferring proxy env when available,
 * otherwise using explicit options if complete, finally falling back to direct env.
 */
export function resolveBlockfrostConfigFromOptsOrEnv(
	opts?: Partial<BlockfrostConfig>
): ResolvedBlockfrost {
	// 1) Prefer proxy env if configured
	const proxyUrl = process.env.BLOCKFROST_PROXY_URL;
	const proxyAlias = process.env.BLOCKFROST_PROXY_PROJECT_ID;
	if (proxyUrl && proxyAlias) {
		return { url: proxyUrl, projectId: proxyAlias };
	}

	// 2) If opts provided and complete, use them
	if (opts?.url && opts?.projectId) {
		return { url: opts.url, projectId: opts.projectId };
	}

	// 3) Fall back to direct env
	return resolveBlockfrostConfigFromEnv();
}


