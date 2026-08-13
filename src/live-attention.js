import fs from 'node:fs';

const MAX_TAIL_BYTES=128*1024;
const asTime=value=>{const time=value instanceof Date?value.getTime():new Date(value).getTime();return Number.isFinite(time)?time:null;};

function jsonlTail(file){
  try{const size=fs.statSync(file).size,bytes=Math.min(size,MAX_TAIL_BYTES),buffer=Buffer.alloc(bytes),fd=fs.openSync(file,'r');fs.readSync(fd,buffer,0,bytes,size-bytes);fs.closeSync(fd);return buffer.toString('utf8').split('\n').slice(size>bytes?1:0).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean);}catch{return [];}
}

// This intentionally reads only structural fields from the bounded tail. It never
// examines prompt, assistant-message, tool-argument, or transcript content.
export function structuredAttentionFromRows(agent,rows=[],at=Date.now()){
  if(agent!=='Codex')return null;
  for(let index=rows.length-1;index>=0;index--){
    const row=rows[index],type=row?.type,payloadType=row?.payload?.type;
    if(type==='event_msg'&&payloadType==='task_complete')return {agent,at:new Date(at).toISOString(),kind:'codex-task-complete',confidence:'Structured',reason:'Codex recorded task completion and has not started a later task.'};
    // Any later non-counter event is evidence of a continuing/new turn. Be
    // conservative: a stale task_complete may not create an attention alert.
    if(type==='response_item'||type==='turn_context'||(type==='event_msg'&&payloadType!=='token_count'))return null;
  }
  return null;
}

export function structuredAttentionFromFile(agent,file,at=Date.now()){
  if(!/\.jsonl$/i.test(String(file||'')))return null;
  return structuredAttentionFromRows(agent,jsonlTail(file),at);
}

export function attentionIsCurrent(attention,now=Date.now(),maxAgeMs=900_000){const at=asTime(attention?.at);return at!=null&&at<=now&&now-at<=maxAgeMs;}
