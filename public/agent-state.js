export const AGENT_STATES={working:'Working',waiting:'Waiting for You',idle:'Idle',unknown:'Unknown'};
export const WORKING_GRACE_MS=12_000;
export const WAITING_WINDOW_MS=300_000;
export const TIMING_VERSION=1;
export const TIMING_TRANSITION_LIMIT=96;

const timestamp=value=>{const time=new Date(value).getTime();return Number.isFinite(time)?time:null};
const totals=()=>({observedWorkingMs:0,waitingForUserMs:0,observedIdleMs:0,unknownMs:0,unobservedMs:0});
const bucket={Working:'observedWorkingMs','Waiting for You':'waitingForUserMs',Idle:'observedIdleMs',Unknown:'unknownMs'};

export function classifyAgentState(events,agent,now=Date.now(),{sourceKnown=true,workingGraceMs=WORKING_GRACE_MS,waitingWindowMs=WAITING_WINDOW_MS}={}){
  if(!sourceKnown)return {agent,state:AGENT_STATES.unknown,since:now,lastEventAt:null,confidence:'Unavailable',reason:'No supported local activity source is available.'};
  const times=events.filter(event=>event.agent===agent).map(event=>timestamp(event.timestamp)).filter(time=>time!=null&&time<=now).sort((a,b)=>a-b),lastEventAt=times.at(-1)||null;
  if(lastEventAt==null)return {agent,state:AGENT_STATES.idle,since:now,lastEventAt:null,confidence:'Observed absence',reason:'No relevant activity has been observed since live tracking started.'};
  const age=now-lastEventAt;
  if(age<=workingGraceMs){let burstStart=lastEventAt;for(let index=times.length-2;index>=0;index--){if(burstStart-times[index]>workingGraceMs)break;burstStart=times[index]}return {agent,state:AGENT_STATES.working,since:burstStart,lastEventAt,confidence:'Observed',reason:'Validated local activity changed within the working window.'};}
  if(age<=waitingWindowMs)return {agent,state:AGENT_STATES.waiting,since:lastEventAt+workingGraceMs,lastEventAt,confidence:'Inferred',reason:'Recent local activity stopped; no native waiting marker is available.'};
  return {agent,state:AGENT_STATES.idle,since:lastEventAt+waitingWindowMs,lastEventAt,confidence:'Observed absence',reason:'No relevant local activity remains inside the recent-session window.'};
}

export function createTimingRecord(agents,now=Date.now()){
  return {version:TIMING_VERSION,trackingStartedAt:new Date(now).toISOString(),lastTickAt:now,agents:Object.fromEntries(agents.map(agent=>[agent,{state:AGENT_STATES.unknown,stateSince:now,totals:totals()}])),transitions:[]};
}

export function advanceTimingRecord(record,states,now=Date.now(),{maxObservedGapMs=5_000}={}){
  const agents=Object.keys(states),next=record?.version===TIMING_VERSION?JSON.parse(JSON.stringify(record)):createTimingRecord(agents,now),rawDelta=Math.max(0,now-Number(next.lastTickAt||now)),observed=rawDelta<=maxObservedGapMs,trackingStartedAt=timestamp(next.trackingStartedAt)??now;
  for(const agent of agents){const current=next.agents[agent]||{state:AGENT_STATES.unknown,stateSince:now,totals:totals()},previousState=current.state;if(observed)current.totals[bucket[previousState]||'unknownMs']+=rawDelta;else current.totals.unobservedMs+=rawDelta;const state=states[agent],supportedSince=Math.max(trackingStartedAt,state.since??now);if(state.state!==previousState){next.transitions.push({agent,from:previousState,to:state.state,at:new Date(now).toISOString(),evidence:state.confidence});current.state=state.state;current.stateSince=supportedSince}else if(current.stateSince==null)current.stateSince=supportedSince;next.agents[agent]=current}
  next.transitions=next.transitions.slice(-TIMING_TRANSITION_LIMIT);next.lastTickAt=now;return next;
}
