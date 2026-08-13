const timeCopy={morning:['Fresh context. Same questionable decisions.','Back already? Yesterday’s bugs missed you.','You have the whole day to overengineer this.'],afternoon:['That quick fix is becoming a feature.','The tokens are moving. Hopefully the project is too.','Still shipping. Technically.'],evening:['You said you were almost done two hours ago.','Somewhere, a simpler implementation is judging you.','One last change has entered the chat.'],late:['Nothing good starts with “one last change.”','Tomorrow-you is going to have questions.','The build is quiet. Your brain is not.']};
const general=['You could stop adding features. You won’t.','A clean diff is a beautiful, temporary thing.','The backlog remains impressively optimistic.','It worked locally. A classic beginning.','Somebody will eventually read this abstraction.'];
const hash=value=>[...String(value)].reduce((n,char)=>(n*31+char.charCodeAt(0))>>>0,7);
const pick=(items,key,avoid)=>{let item=items[hash(key)%items.length];if(item===avoid&&items.length>1)item=items[(hash(key)+1)%items.length];return item};
export function overviewCopy({now=new Date(),summary={},resources={},liveEvents=[],capabilities=[],lastMessage=''}={}) { resources=resources||{};const at=now.getTime(),recent=liveEvents.filter(event=>at-new Date(event.timestamp).getTime()<=30_000),agents=new Set(recent.map(event=>event.agent)),today=summary.activity||[],recentAgents=today.map(event=>event.agent),dominant=recentAgents.length?recentAgents.reduce((counts,agent)=>(counts[agent]=(counts[agent]||0)+1,counts),{}):{},top=Object.entries(dominant).sort((a,b)=>b[1]-a[1])[0],cacheTotal=Object.values(summary.tokens||{}).reduce((sum,value)=>sum+(Number(value)||0),0),unused=capabilities.filter(capability=>capability.health==='No observed use').length; let contextual=null;
  if(agents.size>=3)contextual='Three AIs and somehow you’re still the bottleneck.';
  else if(top&&top[1]/recentAgents.length>=.7&&top[0]==='Claude')contextual='Claude again? The other subscriptions noticed.';
  else if(top&&top[1]/recentAgents.length>=.7&&top[0]==='Codex')contextual='Codex is doing a suspicious amount of the work today.';
  else if(!today.length)contextual='Beautiful dashboard. Shame about the productivity.';
  else if(resources.ram?.ratio>=.88)contextual='Your RAM would like to file a complaint.';
  else if((summary.activeProjects||0)>=6)contextual=`${summary.activeProjects} active projects. Commitment continues to be optional.`;
  else if(unused>=6)contextual='You installed all that. Might be nice to use some of it.';
  else if(cacheTotal&&((summary.tokens?.cacheRead||0)/cacheTotal)>=.55)contextual='At least somebody around here remembers the context.';
  if(contextual&&contextual!==lastMessage)return {message:contextual,kind:'contextual'};
  const hour=now.getHours(),band=hour<12?'morning':hour<17?'afternoon':hour<22?'evening':'late',slot=Math.floor(at/45_000),pool=slot%3===2?general:timeCopy[band]; return {message:pick(pool,`${band}:${slot}`,lastMessage),kind:pool===general?'general':'time'};
}
export function sessionOverviewCopy(current,input={}) { return current||overviewCopy(input).message; }
