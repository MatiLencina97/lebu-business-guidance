import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '1.23.3', 'package version must be 1.23.3');

const sw = read('public/sw.js');
assert.match(sw, /lebu-v1-23-3-shell/);
assert.match(sw, /lebu-v1-23-3-runtime/);
assert.doesNotMatch(sw, /lebu-v1-22-6/);

const calculator = read('src/app/calculadora-precio-venta/page.tsx');
assert.match(calculator, /availableShare <= 0/);
assert.match(calculator, /No existe un precio válido/);

const cloud = read('src/app/cloud-sync.ts');
assert.match(cloud, /LOCAL_STATE_OWNER_KEY/);
assert.match(cloud, /localStateBelongsToCurrentUser/);
assert.match(cloud, /LOCAL_STATE_CLAIM_EMAIL_KEY/);
assert.match(cloud, /explicitClaimMatches/);
assert.match(cloud, /writeLocalStateClaimEmail\(email\)/);
assert.match(cloud, /writeLocalStateOwnerUserId\(currentUser\.id\)/);

const cron = read('src/app/api/cron/morning-push/route.ts');
assert.match(cron, /subscriptionBusinessId/);
assert.match(cron, /snapshotBusinessId \|\| subscriptionBusinessId/);

const production = read('src/app/production-client.ts');
assert.match(production, /lebu_start_production_day/);
assert.match(production, /lebu_close_production_day/);
assert.match(production, /lebu_reopen_production_day/);

const admin = read('src/app/api/admin/metrics/route.ts');
assert.match(admin, /target_mode/);
assert.match(admin, /target_mode === 'break_even'/);

const fudo = read('src/lib/fudo-server.ts');
assert.match(fudo, /items,items\.product/);
assert.match(fudo, /SALES_FALLBACK_INCLUDE/);
assert.match(fudo, /normalizeSaleItems/);

const impossibleMargin = (marginPct, feePct) => 1 - marginPct / 100 - feePct / 100 <= 0;
assert.equal(impossibleMargin(80, 30), true);
assert.equal(impossibleMargin(40, 10), false);

console.log('Lebu QA regression checks passed.');
