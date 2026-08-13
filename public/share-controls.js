export const SHARE_FORMATS=[
  {id:'9:16',label:'Story',dimensions:'1080×1920'},
  {id:'1:1',label:'Square',dimensions:'1080×1080'},
  {id:'4:5',label:'Portrait',dimensions:'1080×1350'},
  {id:'16:9',label:'Wide',dimensions:'1920×1080'}
];

const preferredByPeriod={
  today:['sessions','activeProjects','agentSplit','capabilityUses'],
  month:['sessions','activeProjects','agentSplit','capabilityUses'],
  all:['sessions','activeProjects','agentSplit','capabilityUses']
};

export function defaultShareMetrics(options,period='month'){
  const available=new Set(options.filter(option=>option.available!==false).map(option=>option.id));
  const preferred=(preferredByPeriod[period]||preferredByPeriod.month).filter(id=>available.has(id));
  const supportedTokens=options.filter(option=>option.available!==false&&option.family==='tokens').map(option=>option.id);
  return [...new Set([...(preferred.length?preferred:options.filter(option=>option.available!==false).map(option=>option.id)),...supportedTokens])];
}

export function updateSharePreferences(current,patch){
  const next={...current,...patch};
  const changed=['period','format','metrics','slide'].some(key=>JSON.stringify(current[key])!==JSON.stringify(next[key]));
  return {...next,previewRevision:(current.previewRevision||0)+(changed?1:0)};
}
