import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CAPACITY_SOURCES } from './brands.js';
import { claudeCapacityFromState, installedClaudeVersion, readUsageState } from './claude-capacity.js';

const unavailable=provider=>({provider,status:'Unavailable',message:'Plan usage unavailable through a supported local source.',source:null,observedAt:null,windows:[]});
const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const iso=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString();};
export function normalizeCapacity(provider, raw, observedAt=null) { if(!raw||provider!=='Codex')return unavailable(provider);const windows=[];for(const [key,value]of [['primary',raw.primary],['secondary',raw.secondary]]){if(!value)continue;const used=finite(value.used_percent),minutes=finite(value.window_minutes),reset=value.resets_at?iso(Number(value.resets_at)*1000):null;if(used==null)continue;windows.push({id:key,label:minutes>=10_000?'Weekly':'Current',usedPercent:Math.max(0,Math.min(100,used)),remainingPercent:Math.max(0,Math.min(100,100-used)),windowMinutes:minutes,resetAt:reset});}if(!windows.length)return unavailable(provider);return {provider,status:'Available',message:null,source:'Codex native session rate-limit metadata',observedAt:iso(observedAt),planType:typeof raw.plan_type==='string'?raw.plan_type:null,windows}; }
function collect(root,depth=0,out=[]) { if(depth>5)return out;let entries=[];try{entries=fs.readdirSync(root,{withFileTypes:true});}catch{return out;}for(const entry of entries){const file=path.join(root,entry.name);if(entry.isDirectory())collect(file,depth+1,out);else if(entry.name.endsWith('.jsonl'))try{const stat=fs.statSync(file);out.push({file,mtimeMs:stat.mtimeMs,size:stat.size});}catch{}}return out; }
function findRateLimits(value) { if(!value||typeof value!=='object')return null;if(value.rate_limits&&typeof value.rate_limits==='object')return value.rate_limits;for(const child of Object.values(value)){const found=findRateLimits(child);if(found)return found;}return null; }
function latestCodexCapacity(root) { const files=collect(root).sort((a,b)=>b.mtimeMs-a.mtimeMs).slice(0,20);let latest=null;for(const {file,size}of files){try{const length=Math.min(size,512*1024),buffer=Buffer.alloc(length),fd=fs.openSync(file,'r');fs.readSync(fd,buffer,0,length,size-length);fs.closeSync(fd);let text=buffer.toString('utf8');if(size>length)text=text.slice(text.indexOf('\n')+1);for(const line of text.split('\n')){if(!line.includes('rate_limits'))continue;try{const row=JSON.parse(line),raw=findRateLimits(row);if(!raw)continue;const observedAt=iso(row.timestamp)||new Date().toISOString();if(!latest||observedAt>latest.observedAt)latest={raw,observedAt};}catch{}}}catch{}}return latest; }
export function readPlanCapacity(homeDir=os.homedir()) {
  const codex=latestCodexCapacity(path.join(homeDir,'.codex','sessions'));
  const claude=claudeCapacityFromState(readUsageState(homeDir),{version:installedClaudeVersion(homeDir)});
  const byId={
    Claude:claude,
    Codex:codex?normalizeCapacity('Codex',codex.raw,codex.observedAt):unavailable('Codex'),
    Cursor:unavailable('Cursor')
  };
  return {providers:CAPACITY_SOURCES.map(source=>byId[source.id]||unavailable(source.id)),sampledAt:new Date().toISOString(),privacy:'Uses native local metadata only; no credentials, cookies, browser DOM, or provider API calls. Capacity is account/plan telemetry, not a per-model card. Claude remaining percent is 100 minus statusline used_percentage.'};
}
