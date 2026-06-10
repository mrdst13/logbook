import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				// Fake key so handleAnthropic passes its env check in tests.
				// Upstream fetch is stubbed in the specs — no real API calls.
				miniflare: { bindings: { ANTHROPIC_API_KEY: 'test-key-not-real' } },
			},
		},
	},
});
