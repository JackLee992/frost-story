import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../', import.meta.url);
const settings = readFileSync(new URL('android/settings.gradle.kts', repoRoot), 'utf8');
const [pluginRepositories, dependencyRepositories] = settings.split('dependencyResolutionManagement');

function assertOfficialBeforeMirror(block, label) {
  const firstMirror = block.indexOf('maven.aliyun.com');
  assert.ok(firstMirror > -1, `${label}: mirror fallback is configured`);
  assert.ok(block.indexOf('google()') < firstMirror, `${label}: Google precedes mirror`);
  assert.ok(block.indexOf('mavenCentral()') < firstMirror, `${label}: Maven Central precedes mirror`);
}

assertOfficialBeforeMirror(pluginRepositories, 'plugin repositories');
assertOfficialBeforeMirror(dependencyRepositories, 'dependency repositories');
console.log('Android repository order regression: 6 passed, 0 failed');
