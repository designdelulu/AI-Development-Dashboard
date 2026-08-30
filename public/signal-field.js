import { brandPhase } from './brands.js';

export const SIGNAL_WINDOW_MS=45_000;
export const SIGNAL_EVENT_LIMIT=512;
export const SIGNAL_ATTACK_MS=180;
export const SIGNAL_DECAY_MS=7_500;

const finite=value=>Number.isFinite(Number(value))?Number(value):0;
const at=value=>{const time=new Date(value).getTime();return Number.isFinite(time)?time:null};

export function signalEventWeight(event={}){
  if(event.kind)return 1+Math.min(2,Math.log2(Math.max(0,finite(event.bytesAdded))/512+1));
  return 1+Math.min(2,Math.log2(Math.max(0,finite(event.tools))+1));
}

export function eventSignalEnvelope(event,sampleAt,{attackMs=SIGNAL_ATTACK_MS,decayMs=SIGNAL_DECAY_MS}={}){
  const eventAt=at(event?.timestamp),age=sampleAt-eventAt;
  if(eventAt==null||age<0||age>decayMs*8)return 0;
  const attack=Math.min(1,age/Math.max(1,attackMs));
  const decay=Math.exp(-Math.max(0,age-attackMs)/Math.max(1,decayMs));
  return signalEventWeight(event)*attack*decay;
}

export function signalEnergy(events,agent,sampleAt,options){
  return events.reduce((sum,event)=>event.agent===agent?sum+eventSignalEnvelope(event,sampleAt,options):sum,0);
}

export function boundedSignalEvents(events,now=Date.now(),{windowMs=60_000,limit=SIGNAL_EVENT_LIMIT}={}){
  const cutoff=now-windowMs;
  return events.filter(event=>{const time=at(event.timestamp);return time!=null&&time>=cutoff&&time<=now}).slice(-limit);
}

// Live snapshots replace their own event list on every poll, so repeated live
// events in the same second are distinct observations and must survive. Only
// suppress a live event when an identical historical/base event already owns
// that key; this keeps Cursor hook bursts visible without inventing activity.
export function mergeMonitorEvents(baseEvents=[],liveEvents=[]){
  const key=event=>[event?.timestamp,event?.agent,event?.kind].join('|');
  const base=Array.isArray(baseEvents)?baseEvents:[];
  const baseKeys=new Set(base.map(key));
  const live=Array.isArray(liveEvents)?liveEvents:[];
  return [...base,...live.filter(event=>!baseKeys.has(key(event)))];
}

export function signalBarSample(events,agent,sampleAt,index,{reducedMotion=false,carrier=true}={}){
  const realEnergy=signalEnergy(events,agent,sampleAt),visualEnergy=Math.tanh(realEnergy*.52),agentPhase=brandPhase(agent);
  const baseline=carrier?(reducedMotion?.002:.003+.006*(.5+.5*Math.sin(sampleAt/620+agentPhase+index*.19))):0;
  const carrierTexture=.34+.66*Math.abs(Math.sin(sampleAt/115+agentPhase*2+index*.71))*(.72+.28*Math.abs(Math.cos(index*.37+agentPhase)));
  const density=realEnergy>0?Math.min(1,.2+.8*visualEnergy):0,gate=.5+.5*Math.sin(index*1.77+agentPhase)<=density?1:.2;
  return {realEnergy,visualEnergy,baselineOnly:realEnergy===0,amplitude:Math.min(1,baseline+visualEnergy*(.28+.72*carrierTexture)*gate),opacity:realEnergy===0?(carrier?.035:0):.28+.7*visualEnergy,density};
}
