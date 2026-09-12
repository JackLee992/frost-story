import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../', import.meta.url);
const settings = readFileSync(new URL('android/settings.gradle.kts', repoRoot), 'utf8');
const appBuild = readFileSync(new URL('android/app/build.gradle.kts', repoRoot), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8'));
const [pluginRepositories, dependencyRepositories] = settings.split('dependencyResolutionManagement');

function assertOfficialBeforeMirror(block, label) {
  const firstMirror = block.indexOf('maven.aliyun.com');
  assert.ok(firstMirror > -1, `${label}: mirror fallback is configured`);
  assert.ok(block.indexOf('google()') < firstMirror, `${label}: Google precedes mirror`);
  assert.ok(block.indexOf('mavenCentral()') < firstMirror, `${label}: Maven Central precedes mirror`);
}

assertOfficialBeforeMirror(pluginRepositories, 'plugin repositories');
assertOfficialBeforeMirror(dependencyRepositories, 'dependency repositories');
assert.match(appBuild, /versionCode = 2\b/, 'Android versionCode follows the v0.2 source');
assert.match(appBuild, /versionName = "0\.2\.0"/, 'Android versionName follows the v0.2 source');
assert.match(appBuild, /BUNDLED_CONTENT_VERSION", "\\"0\.2\.0\\""/, 'bundled content version matches the Web source');
assert.equal(packageJson.version, '0.2.0', 'root package version matches the Android source');
console.log('Android build config regression: 10 passed, 0 failed');
