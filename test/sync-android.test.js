import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = new URL('../', import.meta.url).pathname;
const tempRoot = mkdtempSync(join(tmpdir(), 'frost-sync-android-'));
const destination = join(tempRoot, 'missing', 'parents', 'web');

try {
  execFileSync('bash', ['tools/sync_android.sh'], {
    cwd: repoRoot,
    env: { ...process.env, FROST_ANDROID_ASSET_DST: destination },
    stdio: 'pipe',
  });

  assert.ok(existsSync(join(destination, 'index.html')), 'copies the playable web entrypoint');
  assert.ok(
    existsSync(join(destination, 'js/engine/src/action-result.js')),
    'copies the reusable engine runtime',
  );
  assert.equal(existsSync(join(destination, 'js/engine/.git')), false, 'does not ship submodule metadata');
  assert.equal(existsSync(join(destination, 'js/engine/test')), false, 'does not ship engine tests');

  const imageFiles = readdirSync(join(destination, 'assets/img'));
  assert.equal(
    imageFiles.some((name) => name.startsWith('sheet_') || name.startsWith('gen_')),
    false,
    'does not ship source sprite sheets',
  );

  console.log('Android asset sync regression: 5 passed, 0 failed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
