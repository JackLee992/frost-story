#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(readFileSync(resolve(root,'tools/voice/voice-manifest.json')));
const runtimeManifest=JSON.parse(readFileSync(resolve(root,'web/assets/audio/voice/manifest.json')));
const locales=['zh-CN','en','ja','ko'];
if(manifest.clips.length!==864) throw new Error(`expected 864 clips, got ${manifest.clips.length}`);
for(const locale of locales){
  const clips=manifest.clips.filter(clip=>clip.locale===locale);
  if(clips.length!==216||new Set(clips.map(clip=>clip.voiceId)).size!==216) throw new Error(`${locale}: incomplete voice set`);
}
if(new Set(manifest.clips.map(clip=>clip.path)).size!==manifest.clips.length) throw new Error('duplicate voice output paths');
if(manifest.clips.some(clip=>!clip.spoken||clip.spoken.includes('{{'))) throw new Error('manifest contains unsynthesizable spoken placeholders');
const expectedPaths=manifest.clips.map(clip=>clip.path);
if(runtimeManifest.schema!==1||runtimeManifest.total!==864||JSON.stringify(runtimeManifest.locales)!==JSON.stringify({zh:216,en:216,ja:216,ko:216})
  ||JSON.stringify(runtimeManifest.paths)!==JSON.stringify(expectedPaths)) throw new Error('runtime voice manifest does not match generation manifest');
let totalSeconds=0,bytes=0;
for(const clip of manifest.clips){
  const path=resolve(root,'web',clip.path), stat=statSync(path); bytes+=stat.size;
  if(readFileSync(path).subarray(0,4).toString()!=='OggS') throw new Error(`${clip.id}: missing OggS header`);
  const probe=spawnSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_name,sample_rate,channels:format=duration','-of','json',path],{encoding:'utf8'});
  if(probe.status!==0) throw new Error(`${clip.id}: ffprobe failed ${probe.stderr}`);
  const info=JSON.parse(probe.stdout),stream=info.streams?.[0],duration=Number(info.format?.duration||0);
  if(stream?.codec_name!=='opus'||stream.sample_rate!=='48000'||stream.channels!==1||duration<.25||duration>45||stat.size>1_000_000) throw new Error(`${clip.id}: invalid media ${JSON.stringify({stream,duration,bytes:stat.size})}`);
  totalSeconds+=duration;
}
console.log(JSON.stringify({ok:true,clips:manifest.clips.length,durationSeconds:Number(totalSeconds.toFixed(1)),bytes},null,2));
