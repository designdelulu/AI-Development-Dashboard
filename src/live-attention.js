import fs from 'node:fs';

const MAX_TAIL_BYTES=128*1024;
const asTime=value=>{const time=value instanceof Date?value.getTime():new Date(value).getTime();return Number.isFinite(time)?time:null;};

// Codex emits many structured lifecycle records, but only an explicit
// user-action request is an attention state.  A task_complete record means
// the turn ended; it is not an approval/input request and must never become
// Needs You.  Keep this allowlist deliberately narrow so a new/unknown event
// cannot silently turn into a user-facing interruption.
const CODEX_ATTENTION_TYPES = Object.freeze(new Map([
  ['approval_request', { kind: 'approval', reason: 'Codex recorded an explicit approval request.' }],
  ['permission_request', { kind: 'permission', reason: 'Codex recorded an explicit permission request.' }],
  ['request_user_input', { kind: 'input', reason: 'Codex recorded an explicit request for user input.' }],
  ['user_input_request', { kind: 'input', reason: 'Codex recorded an explicit request for user input.' }],
  ['needs_user', { kind: 'attention', reason: 'Codex recorded an explicit request for user action.' }],
  ['needs_attention', { kind: 'attention', reason: 'Codex recorded an explicit request for user action.' }],
  ['awaiting_user', { kind: 'attention', reason: 'Codex recorded an explicit request for user action.' }]
]));

const CODEX_COUNTER_TYPES = new Set(['token_count']);

function codexEventType(row) {
  return row?.type === 'event_msg' && typeof row?.payload?.type === 'string'
    ? row.payload.type.toLowerCase()
    : null;
}

function explicitCodexAttention(type, agent, at) {
  const descriptor = CODEX_ATTENTION_TYPES.get(type);
  if (!descriptor) return null;
  return {
    agent,
    at: new Date(at).toISOString(),
    kind: `codex-${descriptor.kind}`,
    unresolved: true,
    confidence: 'Structured',
    reason: descriptor.reason
  };
}

function jsonlTail(file){
  try{const size=fs.statSync(file).size,bytes=Math.min(size,MAX_TAIL_BYTES),buffer=Buffer.alloc(bytes),fd=fs.openSync(file,'r');fs.readSync(fd,buffer,0,bytes,size-bytes);fs.closeSync(fd);return buffer.toString('utf8').split('\n').slice(size>bytes?1:0).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean);}catch{return [];}
}

// This intentionally reads only structural fields from the bounded tail. It never
// examines prompt, assistant-message, tool-argument, or transcript content.
export function structuredAttentionFromRows(agent,rows=[],at=Date.now()){
  if(agent!=='Codex')return null;
  for(let index=rows.length-1;index>=0;index--){
    const row=rows[index],type=row?.type,payloadType=codexEventType(row);
    if(payloadType && CODEX_COUNTER_TYPES.has(payloadType)) continue;
    const attention=explicitCodexAttention(payloadType,agent,at);
    if(attention) return attention;
    // Any later structured row—including task_complete, task_started,
    // user_message, response_item, and turn_context—resolves/invalidates an
    // earlier request.  Silence and ordinary waiting never create attention.
    if(type==='response_item'||type==='turn_context'||type==='event_msg')return null;
  }
  return null;
}

export function structuredAttentionFromFile(agent,file,at=Date.now()){
  if(!/\.jsonl$/i.test(String(file||'')))return null;
  return structuredAttentionFromRows(agent,jsonlTail(file),at);
}

export function attentionIsCurrent(attention,now=Date.now(),maxAgeMs=900_000){const at=asTime(attention?.at);return attention?.unresolved===true&&at!=null&&at<=now&&now-at<=maxAgeMs;}
