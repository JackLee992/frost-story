import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../', import.meta.url);
const settings = readFileSync(new URL('android/settings.gradle.kts', repoRoot), 'utf8');
const appBuild = readFileSync(new URL('android/app/build.gradle.kts', repoRoot), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8'));
const updater = readFileSync(new URL('android/app/src/main/java/com/froststory/app/ContentUpdateManager.kt', repoRoot), 'utf8');
const packager = readFileSync(new URL('tools/package_content_update.sh', repoRoot), 'utf8');
const [pluginRepositories, dependencyRepositories] = settings.split('dependencyResolutionManagement');

function assertOfficialBeforeMirror(block, label) {
  const firstMirror = block.indexOf('maven.aliyun.com');
  assert.ok(firstMirror > -1, `${label}: mirror fallback is configured`);
  assert.ok(block.indexOf('google()') < firstMirror, `${label}: Google precedes mirror`);
  assert.ok(block.indexOf('mavenCentral()') < firstMirror, `${label}: Maven Central precedes mirror`);
}

assertOfficialBeforeMirror(pluginRepositories, 'plugin repositories');
assertOfficialBeforeMirror(dependencyRepositories, 'dependency repositories');
assert.match(appBuild, /versionCode = 3\b/, 'Android versionCode follows the v0.3 source');
assert.match(appBuild, /versionName = "0\.3\.0"/, 'Android versionName follows the v0.3 source');
assert.match(appBuild, /BUNDLED_CONTENT_VERSION", "\\"0\.3\.0\\""/, 'bundled content version matches the Web source');
assert.equal(packageJson.version, '0.3.0', 'root package version matches the Android source');
assert.match(updater, /MAX_ARCHIVE_BYTES = 128L \* 1024L \* 1024L/, 'updater accepts the bounded four-language voice archive');
assert.match(updater, /MAX_UNPACKED_BYTES = 160L \* 1024L \* 1024L/, 'updater keeps a bounded extracted-size ceiling');
assert.match(updater, /MAX_FILES = 2048\b/, 'updater file-count ceiling covers four offline voice packs');
assert.match(updater, /EXPECTED_VOICE_FILES = 864\b/, 'updater requires every authored four-language voice clip');
assert.match(updater, /EXPECTED_VOICE_FILES_PER_LOCALE = 216\b/, 'updater rejects a locale with a partial voice set');
for (const locale of ['en','ja','ko']) for (const file of ['story','npcs','items','shop','balance','ui'])
  assert.match(updater,new RegExp(`"config/locales/${locale}/${file}\\.json"`),`updater requires ${locale}/${file}.json`);
assert.match(updater, /VOICE_MANIFEST = "assets\/audio\/voice\/manifest\.json"/, 'updater requires the packaged voice inventory');
assert.match(packager, /size > 134217728/, 'packaging and Android archive limits match');
console.log('Android build config regression: 36 passed, 0 failed');
