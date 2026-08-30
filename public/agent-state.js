export const AGENT_STATES={working:'Working',waiting:'Needs You',recent:'Recently Active',idle:'Idle',closed:'Closed',presenceUnknown:'Presence Unknown',telemetryUnavailable:'Live telemetry unavailable',unknown:'Unknown'};
export const WORKING_GRACE_MS=12_000;
// Recent is a short transition state, not a historical activity label. A
// runtime that remains open but has no new validated work becomes Idle after
// this window.
export const RECENT_ACTIVE_WINDOW_MS=30_000;
export const ATTENTION_MAX_AGE_MS=900_000;
export const TIMING_VERSION=2;
export const TIMING_TRANSITION_LIMIT=96;

const timestamp=value=>{const time=new Date(value).getTime();return Number.isFinite(time)?time:null};
const totals=()=>({observedWorkingMs:0,waitingForUserMs:0,recentlyActiveMs:0,observedIdleMs:0,unknownMs:0,unobservedMs:0});
const bucket={Working:'observedWorkingMs','Needs You':'waitingForUserMs','Recently Active':'recentlyActiveMs',Idle:'observedIdleMs',Unknown:'unknownMs'};
const currentAttention=(value,now,maxAgeMs)=>{
  const at=timestamp(value?.at);
  return value?.unresolved===true&&at!=null&&at<=now&&now-at<=maxAgeMs;
};

export function classifyAgentState(events,agent,now=Date.now(),{sourceKnown=true,workingGraceMs=WORKING_GRACE_MS,recentActiveWindowMs=RECENT_ACTIVE_WINDOW_MS,attention=null,attentionMaxAgeMs=ATTENTION_MAX_AGE_MS,inProgress=null,telemetryUnavailable=null,presence=null}={}){
  if(!sourceKnown)return {agent,state:AGENT_STATES.unknown,since:now,lastEventAt:null,confidence:'Unavailable',reason:'No supported local activity source is available.'};
  const times=events.filter(event=>event.agent===agent).map(event=>timestamp(event.timestamp)).filter(time=>time!=null&&time<=now).sort((a,b)=>a-b),lastEventAt=times.at(-1)||null;
  if(presence?.state==='closed')return {agent,state:AGENT_STATES.closed,since:timestamp(presence.checkedAt)??now,lastEventAt,confidence:'Process presence',reason:'The declared local runtime process is not present.'};
  if(presence?.state==='unknown'&&lastEventAt==null&&!inProgress?.active&&!attention)return {agent,state:AGENT_STATES.presenceUnknown,since:timestamp(presence.checkedAt)??now,lastEventAt,confidence:'Presence unavailable',reason:presence.reason||'Runtime presence cannot be determined safely.'};
  const inProgressAt=timestamp(inProgress?.since);
  // Current validated work always outranks an older attention request. This
  // prevents a stale Needs You marker from masking a resumed operation.
  if(inProgress?.active===true&&inProgressAt!=null&&inProgressAt<=now)return {agent,state:AGENT_STATES.working,since:inProgressAt,lastEventAt,confidence:inProgress.confidence||'Structured',reason:inProgress.reason||'A structurally observed local operation remains in progress.'};
  const unavailableAt=timestamp(telemetryUnavailable?.since);
  if(telemetryUnavailable?.active===true&&unavailableAt!=null&&unavailableAt<=now)return {agent,state:AGENT_STATES.telemetryUnavailable,since:unavailableAt,lastEventAt,confidence:telemetryUnavailable.confidence||'Unsupported surface',reason:telemetryUnavailable.reason||'The current local AI surface cannot be interpreted safely.'};
  const attentionAt=timestamp(attention?.at);
  if(currentAttention(attention,now,attentionMaxAgeMs)&& (lastEventAt==null||lastEventAt<=attentionAt)){return {agent,state:AGENT_STATES.waiting,since:attentionAt,lastEventAt,attentionKind:attention.kind||'structured-attention',confidence:'Structured',reason:attention.reason||'A supported local record says this session is awaiting user action.'};}
  if(lastEventAt==null)return {agent,state:AGENT_STATES.idle,since:now,lastEventAt:null,confidence:'Observed absence',reason:'No relevant activity has been observed since live tracking started.'};
  const age=now-lastEventAt;
  if(age<=workingGraceMs){let burstStart=lastEventAt;for(let index=times.length-2;index>=0;index--){if(burstStart-times[index]>workingGraceMs)break;burstStart=times[index]}return {agent,state:AGENT_STATES.working,since:burstStart,lastEventAt,confidence:'Observed',reason:'Validated local activity changed within the working window.'};}
  if(age<=recentActiveWindowMs)return {agent,state:AGENT_STATES.recent,since:lastEventAt+workingGraceMs,lastEventAt,confidence:'Observed',reason:'Recent local activity stopped; no structured signal says user action is required.'};
  return {agent,state:AGENT_STATES.idle,since:lastEventAt+recentActiveWindowMs,lastEventAt,confidence:'Observed absence',reason:'No relevant local activity remains inside the recent-session window.'};
}

export function createTimingRecord(agents,now=Date.now()){
  return {version:TIMING_VERSION,trackingStartedAt:new Date(now).toISOString(),lastTickAt:now,agents:Object.fromEntries(agents.map(agent=>[agent,{state:AGENT_STATES.unknown,stateSince:now,totals:totals()}])),transitions:[]};
}

export function advanceTimingRecord(record,states,now=Date.now(),{maxObservedGapMs=5_000}={}){
  const agents=Object.keys(states),next=record?.version===TIMING_VERSION?JSON.parse(JSON.stringify(record)):createTimingRecord(agents,now),rawDelta=Math.max(0,now-Number(next.lastTickAt||now)),observed=rawDelta<=maxObservedGapMs,trackingStartedAt=timestamp(next.trackingStartedAt)??now;
  for(const agent of agents){const current=next.agents[agent]||{state:AGENT_STATES.unknown,stateSince:now,totals:totals()},previousState=current.state;if(observed)current.totals[bucket[previousState]||'unknownMs']+=rawDelta;else current.totals.unobservedMs+=rawDelta;const state=states[agent],supportedSince=Math.max(trackingStartedAt,state.since??now);if(state.state!==previousState){next.transitions.push({agent,from:previousState,to:state.state,at:new Date(now).toISOString(),evidence:state.confidence});current.state=state.state;current.stateSince=supportedSince}else if(current.stateSince==null)current.stateSince=supportedSince;next.agents[agent]=current}
  next.transitions=next.transitions.slice(-TIMING_TRANSITION_LIMIT);next.lastTickAt=now;return next;
}
