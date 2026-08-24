import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { discoverProjects, derive, normalizeUsage, tokenActivity, capabilityUsageEvents, groupCapabilities, classifyCapability, classifyRepository, maintenanceGroups, duplicateInvestigations, applyProjectMetadata, achievementsFor, ACHIEVEMENT_TIERS, discoverNativeAutomations, CONFIDENCE, observedModel, gitSnapshot } from '../src/core.js';
import { AGENT_ASSETS, agentAsset, agentMarkScale, shareableStack, manifest, createSnapshot, shareCardSvg, setupPrompt, recapFor, publicMetricOptions, storyCardsFor } from '../src/sharing.js';
import { defaultShareMetrics, updateSharePreferences } from '../public/share-controls.js';
import { activityEventWeight, activityIntensityAt, activitySeries, activityMonitor, cpuUtilization, liveStateSnapshot, normalizeResources, sessionFileSignal } from '../src/activity.js';
import { overviewCopy, sessionOverviewCopy } from '../public/overview-copy.js';
import { boundedSignalEvents, eventSignalEnvelope, signalBarSample, signalEnergy } from '../public/signal-field.js';
import { advanceTimingRecord, classifyAgentState, createTimingRecord } from '../public/agent-state.js';
import { normalizeCapacity, readPlanCapacity } from '../src/capacity.js';
import { createPresenceSampler, processSnapshot, runtimePresenceStates, PRESENCE_STALE_GOOD_MS } from '../src/runtime-presence.js';
import { resolveProjectRoots } from '../src/config.js';
import { lastSessionForProject, liveStatesFromEvents, observedContext, projectHandoff, rankResumeCandidates, startHereRecommendation } from '../src/resume.js';
import { openAgentCommand } from '../src/open-agent.js';
import { claudeLiveDecision, cursorLiveDecision, isClaudeLivePath, isCursorLivePath, isDashboardGeneratedClaudePath } from '../src/live-files.js';
import { structuredAttentionFromRows } from '../src/live-attention.js';
import { resumeContextPresentation } from '../public/resume-ui.js';
import { inferAgentFromModel, inferProvider, sessionIdentity, emptyHarnessRun, harnessWorker } from '../src/identity.js';
import { localDateKey, periodBounds, tokenReports } from '../src/tokens.js';
import { releaseInfo } from '../src/release.js';
import { auditText, auditTree } from '../src/privacy-audit.js';
import { detectProjectRoots, resolveProjectRoots as resolveRoots } from '../src/config.js';
import { footerMarkup, needsYouPanel, startHereCard, tokenModule } from '../public/live-ui.js';

function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidash-')); fs.mkdirSync(path.join(root, 'alpha', '.git'), { recursive: true }); fs.writeFileSync(path.join(root, 'alpha', 'app.js'), 'export const answer = 42;\n'); return root; }
test('discovers a canonical Git project', () => { const root = fixture(); const projects = discoverProjects(root); assert.equal(projects.length, 1); assert.equal(projects[0].name, 'alpha'); assert.equal(projects[0].confidence, CONFIDENCE.confirmed); });
test('separates cache token fields from fresh input and output', () => { const t=normalizeUsage({usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:100,cache_creation_input_tokens:20}}); assert.deepEqual(t,{freshInput:10,output:5,cacheRead:100,cacheCreation:20,reasoning:0,other:0}); assert.equal(tokenActivity(t),135); });
test('headline project analytics exclude unknown attribution', () => { const root = fixture(), project=discoverProjects(root)[0]; const s=(id,projectId,confidence)=>({id,agent:'Claude',projectId,timestamp:'2026-08-10T00:00:00Z',tokens:{freshInput:10,output:5,cacheRead:0,cacheCreation:0,reasoning:0,other:0},tools:1,compactions:0,attributionConfidence:confidence}); const r=derive({projects:[project],capabilities:[],capabilityUsageEvents:[],errors:[],sources:{},sessions:[s('a',project.id,CONFIDENCE.confirmed),s('b',null,CONFIDENCE.unknown)]}); assert.equal(r.projects[0].sessionCount,1); assert.equal(r.summary.sessions,2); });
test('structured capability evidence becomes a confirmed compact event',()=>{const cap={id:'c1',capabilityKey:'graphify',name:'graphify'},session={id:'Claude:1',projectId:'p1',timestamp:'2026-08-01T00:00:00Z'};const events=capabilityUsageEvents([{sessionId:'Claude:1',skill:'graphify',timestamp:session.timestamp,sourceFile:'/private'}],[cap],[session]);assert.equal(events.length,1);assert.equal(events[0].confidence,CONFIDENCE.confirmed);assert.equal(events[0].contextLabel,'graphify workflow');});
test('groups plugin components under one recognizable capability',()=>{const raw=[{id:'a',name:'Caveman',type:'Instruction',origin:'Claude plugin',location:'/Users/x/.claude/plugins/cache/caveman/a/CLAUDE.md',isPrivate:false},{id:'b',name:'help',type:'Command',origin:'Claude plugin',location:'/Users/x/.claude/plugins/cache/caveman/a/commands/help.md',isPrivate:false},{id:'c',name:'Other',type:'Command',origin:'Claude plugin',location:'/Users/x/.claude/plugins/cache/other/a/commands/help.md',isPrivate:false}];const groups=groupCapabilities(raw,[]);assert.equal(groups.length,2);assert.equal(groups.find(x=>x.name==='Caveman').components.length,2);});
test('public stack excludes private capabilities and paths',()=>{const index={summary:{agents:['Claude'],tokens:{freshInput:1,output:2},sessions:1,activeProjects:1,capabilityUses:0},sessions:[],efficiency:{components:{tokensPerSession:{comparable:false}},period:{}},capabilities:[{name:'Public',type:'Agent Skill',origin:'Claude user',agents:['Claude'],components:[],isPrivate:false,usageCount:0},{name:'Secret',type:'Agent Skill',origin:'Project',agents:[],components:[],isPrivate:true,installation:['/Users/name/secret'],usageCount:0}]};assert.equal(shareableStack(index).capabilities.length,1);assert.equal(JSON.stringify(manifest(index)).includes('/Users/'),false);});
test('setup prompt is dynamic and excludes private locations',()=>{const base={summary:{agents:['Claude'],tokens:{freshInput:1,output:2},sessions:1,activeProjects:1,capabilityUses:0},sessions:[],efficiency:{components:{tokensPerSession:{comparable:false}},period:{}},capabilities:[{name:'Public',type:'Agent Skill',origin:'Claude user',agents:['Claude'],components:[],isPrivate:false,usageCount:0}]};const one=setupPrompt(base);base.capabilities[0].name='Changed';const two=setupPrompt(base);assert.match(two,/Changed/);assert.notEqual(one,two);assert.equal(two.includes('/Users/'),false);});
test('snapshot freezes selected values and cards honor requested dimensions',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snap-')),timestamp=new Date().toISOString();const index={summary:{agents:['Claude'],tokens:{freshInput:20,output:2},sessions:4,activeProjects:2,capabilityUses:0},sessions:[{agent:'Claude',timestamp}],efficiency:{components:{tokensPerSession:{comparable:false}},period:{}},capabilities:[]};const snap=createSnapshot(index,['sessions'],'9:16',dir);assert.equal(snap.metrics[0].value,1);assert.match(shareCardSvg(snap),/width="1080" height="1920"/);});
test('share token pipeline preserves Claude fresh input and output through snapshot and renderer',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'token-share-')),now=new Date(),index={summary:{agents:['Claude','Codex']},sessions:[{agent:'Claude',timestamp:now.toISOString(),tokens:{freshInput:321,output:87,cacheRead:4000,cacheCreation:18}},{agent:'Codex',timestamp:now.toISOString(),tokens:{}}],efficiency:{components:{}},capabilityUsageEvents:[]},options=publicMetricOptions(index,'today',now).options,fresh=options.find(metric=>metric.id==='freshInput'),output=options.find(metric=>metric.id==='output'),snap=createSnapshot(index,['freshInput','output'],'1:1',dir,'today'),svg=shareCardSvg(snap);assert.equal(fresh.value,321);assert.equal(output.value,87);assert.deepEqual(snap.metrics.map(metric=>metric.value),[321,87]);assert.match(svg,/Fresh input tokens/);assert.match(svg,/>321</);assert.match(svg,/Output tokens/);assert.match(svg,/>87</);});
test('share token option explains unavailable selected-period data instead of rendering a fake zero',()=>{const now=new Date('2026-08-13T12:00:00Z'),index={summary:{agents:['Claude']},sessions:[{agent:'Claude',timestamp:'2026-08-12T12:00:00Z',tokens:{freshInput:44,output:9}}],efficiency:{components:{}},capabilityUsageEvents:[]},options=publicMetricOptions(index,'today',now).options,fresh=options.find(metric=>metric.id==='freshInput');assert.equal(fresh.available,false);assert.equal(fresh.value,null);assert.match(fresh.unavailable,/No supported fresh input token data for Today/);});
test('share controls update preview revisions automatically for period, format, metrics, and slide',()=>{const initial={period:'month',format:'9:16',metrics:['sessions'],slide:'intro',previewRevision:0},period=updateSharePreferences(initial,{period:'today'}),format=updateSharePreferences(period,{format:'1:1'}),metrics=updateSharePreferences(format,{metrics:['sessions','agentSplit']}),slide=updateSharePreferences(metrics,{slide:'agents'});assert.equal(period.previewRevision,1);assert.equal(format.previewRevision,2);assert.equal(metrics.previewRevision,3);assert.equal(slide.previewRevision,4);assert.equal(updateSharePreferences(slide,{slide:'agents'}).previewRevision,4);assert.deepEqual(defaultShareMetrics([{id:'freshInput',available:false},{id:'sessions',available:true},{id:'agentSplit',available:true}],'today'),['sessions','agentSplit']);});
test('monthly story defaults include supported token categories as their own truthful slide',()=>{assert.deepEqual(defaultShareMetrics([{id:'sessions',available:true,family:'activity'},{id:'agentSplit',available:true,family:'agents'},{id:'freshInput',available:true,family:'tokens'},{id:'cacheRead',available:true,family:'tokens'}],'month'),['sessions','agentSplit','freshInput','cacheRead']);});
test('share experience has no manual preview button and exposes automatic story controls',()=>{const source=fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8');assert.doesNotMatch(source,/Update Preview/);assert.match(source,/class="drawer-head"/);assert.match(source,/class="share-toolbar"/);assert.match(source,/Export all/);assert.match(source,/Play slideshow/);assert.match(source,/renderPreview\(\)/);});
test('agent mark scaling is proportional, deterministic, and preserves zero without changing snapshots',()=>{const small=agentMarkScale(8,60),large=agentMarkScale(60,60);assert.equal(agentMarkScale(0,60),0);assert.equal(agentMarkScale(8,60),small);assert.ok(large>small);const snapshot=Object.freeze({metrics:[Object.freeze({id:'agentSplit',label:'Agent session split',family:'agents',available:true,value:Object.freeze([{agent:'Claude',sessions:60},{agent:'Cursor',sessions:0}])})],period:{title:'TODAY',id:'today'},format:'1:1'}),before=JSON.stringify(snapshot);shareCardSvg(snapshot);assert.equal(JSON.stringify(snapshot),before);});
test('share cards embed verified local agent assets without changing snapshot values',()=>{for(const [agent,asset]of Object.entries(AGENT_ASSETS)){assert.ok(fs.existsSync(path.join(process.cwd(),'public','assets','agents',asset.filename)));assert.match(agentAsset(agent),/^data:image\/png;base64,/);}const snapshot=Object.freeze({metrics:[Object.freeze({id:'agentSplit',label:'Agent session split',family:'agents',available:true,value:Object.freeze([{agent:'Claude',sessions:6},{agent:'Codex',sessions:3},{agent:'Cursor',sessions:0}])})],period:{title:'TODAY',id:'today'},format:'1:1',story:{selected:'agents',rankings:{agents:[{agent:'Claude',sessions:6},{agent:'Codex',sessions:3},{agent:'Cursor',sessions:0}]}}}),before=JSON.stringify(snapshot),svg=shareCardSvg(snapshot);assert.equal((svg.match(/data:image\/png;base64/g)||[]).length,3);assert.match(svg,/#1/);assert.equal(JSON.stringify(snapshot),before);});
test('agent ranking keeps every known agent recognisable without ranking a zero as activity',()=>{const snapshot={metrics:[{id:'agentSplit',label:'Agent session split',family:'agents',available:true,value:[{agent:'Claude',sessions:6},{agent:'Codex',sessions:3},{agent:'Cursor',sessions:0}]}],period:{title:'TODAY',id:'today'},format:'1:1',story:{selected:'agents'}};const svg=shareCardSvg(snapshot);assert.match(svg,/>#1</);assert.match(svg,/>#2</);assert.doesNotMatch(svg,/>#3</);assert.match(svg,/Cursor/);assert.match(svg,/No observed sessions this period/);});
test('Share Stats agent bars use the displayed total session share rather than normalizing the leader',()=>{const snapshot={metrics:[{id:'agentSplit',label:'Agent session split',family:'agents',available:true,value:[{agent:'Codex',sessions:66},{agent:'Claude',sessions:34}]}],period:{title:'TODAY',id:'today'},format:'16:9',story:{selected:'agents'}},svg=shareCardSvg(snapshot);assert.match(svg,/>66%</);assert.match(svg,/>34%</);assert.match(svg,/width="1052\.04" height="12"/);assert.match(svg,/width="541\.96" height="12"/);});
test('share snapshot carries a deterministic multi-slide story foundation',()=>{const recap={id:'month',rankings:{agents:[{agent:'Claude',sessions:1}],capabilities:[]},achievements:[]},metrics=[{id:'sessions',family:'activity'},{id:'agentSplit',family:'agents'},{id:'freshInput',family:'tokens'}],cards=storyCardsFor(recap,metrics);assert.deepEqual(cards.map(card=>card.id),['intro','agents','activity','tokens']);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'story-')),now=new Date(),index={summary:{agents:['Claude']},sessions:[{agent:'Claude',timestamp:now.toISOString(),tokens:{freshInput:4}}],efficiency:{components:{}},capabilityUsageEvents:[]},snapshot=createSnapshot(index,['sessions','agentSplit','freshInput'],'1:1',dir,'month',{slide:'agents'});assert.equal(snapshot.story.version,2);assert.equal(snapshot.story.selected,'agents');assert.ok(snapshot.story.cards.some(card=>card.id==='agents'));});
test('desktop share workspace declares an intentional large-screen layout tier',()=>{const styles=fs.readFileSync(path.join(process.cwd(),'public','overrides.css'),'utf8');assert.match(styles,/@media\(min-width:1200px\)/);assert.match(styles,/grid-template-columns:350px minmax\(0,1fr\)/);assert.match(styles,/width:min\(1340px/);});
test('separates capability type, scope, completeness and agent coverage',()=>{const raw=[{id:'skill',name:'Impeccable',type:'Agent Skill',origin:'Project',projectId:'project:design',location:'/Users/x/Dropbox/Projects/design/.claude/skills/impeccable/SKILL.md',isPrivate:false},{id:'instruction',name:'CLAUDE',type:'Instruction',origin:'Project',projectId:'project:design',location:'/Users/x/Dropbox/Projects/design/CLAUDE.md',isPrivate:false},{id:'plugin',name:'Caveman',type:'Agent Skill',origin:'Claude plugin',location:'/Users/x/.claude/plugins/cache/caveman/a/skills/caveman/SKILL.md',isPrivate:false}];const groups=groupCapabilities(raw,[]),skill=groups.find(x=>x.name==='Impeccable'),instruction=groups.find(x=>x.name==='CLAUDE'),plugin=groups.find(x=>x.name==='Caveman');assert.equal(skill.type,'Skills');assert.equal(skill.scope,'Project-specific');assert.equal(skill.artifactState,'Complete');assert.equal(instruction.type,'Instructions');assert.equal(instruction.scope,'Project-specific');assert.equal(plugin.type,'Tools');assert.equal(plugin.artifactState,'Unknown');assert.equal(plugin.artifactState==='Partial',false);assert.equal(skill.agentCoverage.find(x=>x.agent==='Claude').state,'Installed');});
test('maintenance aggregates recognizable parents into meaningful groups',()=>{const caps=[{id:'a',name:'Broken skill',type:'Skills',scope:'Shared',artifactState:'Broken',health:'No observed use',updateStatus:'Update status unknown',agentCoverage:[]},{id:'b',name:'Healthy tool',type:'Tools',scope:'Shared',artifactState:'Complete',health:'Active',updateStatus:'Update status unknown',agentCoverage:[]}];const groups=maintenanceGroups(caps);assert.equal(groups.needsAction.length,1);assert.equal(groups.usageReview.length,1);assert.equal(groups.usageReview[0].name,'Broken skill');assert.equal(groups.updates.length,0);});
test('project pin, status and note persist outside scanner output and are private',()=>{const index={projects:[{id:'project:a',name:'Alpha'}],summary:{agents:[],tokens:{},sessions:0,activeProjects:1,capabilityUses:0},capabilities:[],sessions:[],efficiency:{components:{tokensPerSession:{comparable:false}},period:{}}};const decorated=applyProjectMetadata(index,{projects:{'project:a':{pinned:true,status:'Waiting',note:'Finish private QA.'}}});assert.deepEqual(decorated.projects[0].pinned,true);assert.equal(decorated.projects[0].status,'Waiting');assert.equal(decorated.projects[0].note,'Finish private QA.');assert.equal(JSON.stringify(shareableStack(decorated)).includes('Finish private QA.'),false);});
test('achievements are deterministic, tiered, and never reward raw token totals',()=>{const index={sessions:[{agent:'Claude',timestamp:'2026-08-01T00:00:00Z'},{agent:'Codex',timestamp:'2026-08-02T00:00:00Z'},{agent:'Claude',timestamp:'2026-08-03T00:00:00Z'},{agent:'Codex',timestamp:'2026-08-04T00:00:00Z'},{agent:'Claude',timestamp:'2026-08-05T00:00:00Z'},{agent:'Codex',timestamp:'2026-08-06T00:00:00Z'},{agent:'Claude',timestamp:'2026-08-07T00:00:00Z'}],summary:{capabilityUses:3,tokens:{freshInput:999999999}}};const earned=achievementsFor(index),ids=earned.map(x=>x.id);assert.deepEqual(ids,['multi-agent-builder','capability-in-practice','consistent-builder']);assert.equal(ACHIEVEMENT_TIERS.length,6);assert.ok(earned.every(item=>item.tier?.id&&item.badge?.assetSlot));});
test('activity intensity comes only from real timestamped events and decays',()=>{const now=1_000_000,events=[{agent:'Claude',timestamp:new Date(now-1_000).toISOString(),tools:3}];const fresh=activityIntensityAt(events,'Claude',now),later=activityIntensityAt(events,'Claude',now+9_000),idle=activityIntensityAt(events,'Codex',now);assert.equal(activityEventWeight({tools:0}),1);assert.ok(fresh>later);assert.ok(later>0);assert.equal(idle,0);assert.equal(activityIntensityAt([], 'Claude',now),0);});
test('activity monitor supports simultaneous real agent activity without fabricated spikes',()=>{const now=2_000_000,events=[{agent:'Claude',timestamp:new Date(now-2_000).toISOString(),tools:1},{agent:'Codex',timestamp:new Date(now-3_000).toISOString(),tools:0},{agent:'Cursor',timestamp:new Date(now-4_000).toISOString(),tools:2}];const monitor=activityMonitor(events,now),series=activitySeries(events,'Claude',now,{windowMs:4_000,sampleMs:1_000});assert.deepEqual(monitor.map(x=>x.state),['Active','Active','Active']);assert.equal(series.length,5);assert.equal(series[0].intensity,0);assert.ok(series.at(-1).intensity>0);});
test('real events create deterministic signal envelopes with attack and decay',()=>{const at=1_000_000,event={agent:'Claude',timestamp:new Date(at).toISOString(),kind:'session-file-update',bytesAdded:2048},attack=eventSignalEnvelope(event,at+180),later=eventSignalEnvelope(event,at+9_000);assert.equal(eventSignalEnvelope(event,at),0);assert.ok(attack>later);assert.ok(later>0);assert.equal(eventSignalEnvelope(event,at-1),0);assert.equal(eventSignalEnvelope(event,at+100_000),0);});
test('repeated real events create denser signal energy while idle carrier stays presentation-only',()=>{const now=2_000_000,event={agent:'Codex',timestamp:new Date(now-500).toISOString(),kind:'session-file-update',bytesAdded:1024},one=signalEnergy([event],'Codex',now),two=signalEnergy([event,{...event,timestamp:new Date(now-350).toISOString()}],'Codex',now),idle=signalBarSample([],'Cursor',now,4),silent=signalBarSample([],'Cursor',now,4,{carrier:false}),active=signalBarSample([event],'Codex',now,4);assert.ok(two>one);assert.equal(idle.realEnergy,0);assert.equal(idle.baselineOnly,true);assert.ok(idle.amplitude>0);assert.equal(silent.amplitude,0);assert.equal(silent.opacity,0);assert.ok(active.realEnergy>0);assert.equal(signalBarSample([event],'Codex',now,4).amplitude,active.amplitude);});
test('silence alone becomes Recently Active then Idle, never Needs You',()=>{const last=3_000_000,event={agent:'Cursor',timestamp:new Date(last).toISOString()};assert.equal(classifyAgentState([event],'Cursor',last+5_000).state,'Working');const recent=classifyAgentState([event],'Cursor',last+20_000);assert.equal(recent.state,'Recently Active');assert.equal(recent.confidence,'Observed');assert.notEqual(recent.state,'Needs You');assert.equal(classifyAgentState([event],'Cursor',last+301_000).state,'Idle');assert.equal(classifyAgentState([],'Cursor',last,{sourceKnown:false}).state,'Unknown');});
test('presence only distinguishes Idle from Closed and never produces work',()=>{const now=3_000_000,closed={state:'closed',checkedAt:new Date(now).toISOString()},present={state:'present',checkedAt:new Date(now).toISOString()},unknown={state:'unknown',checkedAt:new Date(now).toISOString()};assert.equal(classifyAgentState([],'Cursor',now,{presence:closed}).state,'Closed');assert.equal(classifyAgentState([],'Cursor',now,{presence:present}).state,'Idle');assert.equal(classifyAgentState([],'Cursor',now,{presence:unknown}).state,'Presence Unknown');assert.equal(classifyAgentState([{agent:'Cursor',timestamp:new Date(now).toISOString()}],'Cursor',now,{presence:present}).state,'Working');assert.equal(classifyAgentState([{agent:'Cursor',timestamp:new Date(now).toISOString()}],'Cursor',now,{presence:closed}).state,'Closed');});
test('runtime presence examines executable identities only and caches its process snapshot',()=>{const runtimes=[{agent:'Cursor',liveCapable:true,presence:{processNames:['cursor'],processPathSuffixes:['cursor.app/contents/macos/cursor']}},{agent:'Claude',liveCapable:true,presence:{processPathIncludes:['/claude-code/']}},{agent:'Synthetic',liveCapable:true}];const snapshot={reliable:true,checkedAt:'2026-08-22T00:00:00.000Z',commands:['/Applications/Cursor.app/Contents/MacOS/Cursor','/Library/Application Support/Claude/claude-code/2.1.237/claude.app/Contents/MacOS/claude']},states=runtimePresenceStates(runtimes,snapshot);assert.equal(states.Cursor.state,'present');assert.equal(states.Claude.state,'present');assert.equal(states.Synthetic.state,'unknown');assert.equal(runtimePresenceStates(runtimes,{...snapshot,commands:['/Applications/Claude.app/Contents/MacOS/Claude']}).Claude.state,'closed');let calls=0,now=0;const sampler=createPresenceSampler({runtimes,pollMs:5_000,now:()=>now,snapshot:()=>{calls++;return snapshot;}});sampler();sampler();now=4_999;sampler();assert.equal(calls,1);now=5_000;sampler();assert.equal(calls,2);const unavailable=processSnapshot({platform:'win32',now:()=>0});assert.equal(unavailable.reliable,false);});
test('a transient process snapshot failure preserves fresh presence before bounded Unknown',()=>{const runtimes=[{agent:'Cursor',liveCapable:true,presence:{processNames:['cursor']}}];let now=0,calls=0;const sampler=createPresenceSampler({runtimes,pollMs:5_000,staleGoodMs:PRESENCE_STALE_GOOD_MS,now:()=>now,snapshot:()=>{calls++;return calls===1?{reliable:true,checkedAt:new Date(now).toISOString(),commands:['cursor']}:{reliable:false,checkedAt:new Date(now).toISOString(),commands:[],reason:'temporary failure'};}});assert.equal(sampler().Cursor.state,'present');now=5_000;assert.equal(sampler().Cursor.state,'present');assert.equal(sampler().Cursor.stale,true);now=PRESENCE_STALE_GOOD_MS+5_001;assert.equal(sampler().Cursor.state,'unknown');});
test('Codex task completion is normal idle lifecycle, not current attention',()=>{const at=3_000_000,rows=[{type:'event_msg',payload:{type:'task_complete'}}],marker=structuredAttentionFromRows('Codex',rows,at);assert.equal(marker,null);assert.equal(structuredAttentionFromRows('Claude',[{type:'assistant',message:{stop_reason:'end_turn'}}],at),null);assert.equal(structuredAttentionFromRows('Cursor',[{type:'turn_ended',status:'success'}],at),null);const completed={agent:'Codex',timestamp:new Date(at).toISOString()};assert.equal(classifyAgentState([completed],'Codex',at+20_000,{presence:{state:'present',checkedAt:new Date(at).toISOString()}}).state,'Recently Active');assert.equal(classifyAgentState([completed],'Codex',at+301_000,{presence:{state:'present',checkedAt:new Date(at).toISOString()}}).state,'Idle');assert.equal(structuredAttentionFromRows('Codex',[...rows,{type:'event_msg',payload:{type:'task_started'}}],at),null);assert.equal(structuredAttentionFromRows('Codex',[...rows,{type:'response_item',payload:{type:'message'}}],at),null);});
test('explicit Codex attention remains unresolved until structured resolution or work',()=>{const at=3_000_000,request={type:'event_msg',payload:{type:'approval_request'}},attention=structuredAttentionFromRows('Codex',[request],at);assert.equal(attention?.kind,'codex-approval');assert.equal(attention?.unresolved,true);assert.equal(classifyAgentState([],'Codex',at+20_000,{attention,presence:{state:'present'}}).state,'Needs You');assert.equal(structuredAttentionFromRows('Codex',[request,{type:'event_msg',payload:{type:'task_complete'}}],at),null);assert.equal(structuredAttentionFromRows('Codex',[request,{type:'event_msg',payload:{type:'task_started'}}],at),null);const resumed={agent:'Codex',timestamp:new Date(at+21_000).toISOString()};assert.equal(classifyAgentState([resumed],'Codex',at+25_000,{attention}).state,'Working');});
test('resolved attention never remains current after a long idle interval',()=>{const at=3_000_000,attention=structuredAttentionFromRows('Codex',[{type:'event_msg',payload:{type:'request_user_input'}}],at),present={state:'present',checkedAt:new Date(at).toISOString()};assert.equal(classifyAgentState([],'Codex',at+14*60*60*1000,{attention,presence:present}).state,'Idle');assert.equal(classifyAgentState([],'Codex',at+20_000,{attention:{...attention,unresolved:false},presence:present}).state,'Idle');assert.equal(classifyAgentState([],'Codex',at+20_000,{attention,presence:{state:'closed',checkedAt:new Date(at).toISOString()}}).state,'Closed');});
test('dynamic adapter attention uses the common state resolver',()=>{const at=3_000_000,attention={agent:'Synthetic',at:new Date(at).toISOString(),kind:'synthetic-approval',unresolved:true,confidence:'Structured'},states=liveStatesFromEvents([],['Synthetic'],at+1_000,{Synthetic:attention},{},{Synthetic:{state:'present',checkedAt:new Date(at).toISOString()}});assert.equal(states.Synthetic.state,'Needs You');const resumed=classifyAgentState([],'Synthetic',at+1_000,{attention,inProgress:{active:true,since:new Date(at+500).toISOString(),confidence:'Structured'},presence:{state:'present'}});assert.equal(resumed.state,'Working');});
test('live timing accumulates observed states, excludes suspended gaps, and never reconstructs history',()=>{const start=4_000_000,working={Claude:{state:'Working',since:start,confidence:'Observed'}},recent={Claude:{state:'Recently Active',since:start-90_000,confidence:'Observed'}},waiting={Claude:{state:'Needs You',since:start-90_000,confidence:'Structured'}},initial=createTimingRecord(['Claude'],start),begun=advanceTimingRecord(initial,working,start),worked=advanceTimingRecord(begun,working,start+1_000),changed=advanceTimingRecord(worked,recent,start+2_000),recenter=advanceTimingRecord(changed,recent,start+3_000),needs=advanceTimingRecord(recenter,waiting,start+4_000),waited=advanceTimingRecord(needs,waiting,start+5_000),suspended=advanceTimingRecord(waited,waiting,start+22_000);assert.equal(worked.agents.Claude.totals.observedWorkingMs,1_000);assert.equal(recenter.agents.Claude.totals.recentlyActiveMs,1_000);assert.equal(waited.agents.Claude.totals.waitingForUserMs,1_000);assert.equal(suspended.agents.Claude.totals.unobservedMs,17_000);assert.equal(begun.agents.Claude.stateSince,start);const fresh=advanceTimingRecord(createTimingRecord(['Claude'],start),waiting,start);assert.equal(fresh.agents.Claude.stateSince,start);assert.equal(fresh.agents.Claude.totals.waitingForUserMs,0);});
test('signal history remains bounded and discards stale or future records',()=>{const now=5_000_000,events=Array.from({length:620},(_,index)=>({agent:'Codex',timestamp:new Date(now-59_000+index*90).toISOString()}));events.unshift({agent:'Claude',timestamp:new Date(now-70_000).toISOString()});events.push({agent:'Cursor',timestamp:new Date(now+1_000).toISOString()});const bounded=boundedSignalEvents(events,now);assert.equal(bounded.length,512);assert.ok(bounded.every(event=>new Date(event.timestamp).getTime()>=now-60_000&&new Date(event.timestamp).getTime()<=now));});
test('resource normalization handles missing telemetry and deterministic cpu deltas',()=>{const previous=[{times:{user:30,sys:10,idle:60}}],current=[{times:{user:50,sys:20,idle:130}}];assert.equal(cpuUtilization(previous,current),30);const normalized=normalizeResources({totalMemory:100,freeMemory:35,cpuPercent:50,dashboardRss:12,dashboardCpuPercent:3});assert.deepEqual(normalized.ram,{used:65,total:100,ratio:.65});assert.equal(normalizeResources({}).cpuPercent,null);});
test('live file signals are real, weighted by growth, and decay independently',()=>{const now=3_000_000,claude=sessionFileSignal({agent:'Claude',timestamp:now,previousSize:100,size:2148}),codex=sessionFileSignal({agent:'Codex',timestamp:now-1_000,previousSize:20,size:20}),cursor=sessionFileSignal({agent:'Cursor',timestamp:now-2_000,previousSize:1,size:65});assert.equal(sessionFileSignal({agent:'Unknown',timestamp:now}),null);assert.ok(activityEventWeight(claude)>activityEventWeight(codex));assert.deepEqual(activityMonitor([claude,codex,cursor],now).map(x=>x.state),['Active','Active','Active']);assert.ok(activityIntensityAt([claude],'Claude',now)>activityIntensityAt([claude],'Claude',now+9_000));});
test('live transport snapshot delivers current resources and only bounded real events',()=>{const now=4_000_000,system={cpuPercent:42},capacity={Codex:{status:'Available'}},events=[{agent:'Claude',timestamp:new Date(now-59_000).toISOString()},{agent:'Cursor',timestamp:new Date(now-61_000).toISOString()}],snapshot=liveStateSnapshot({system,events,capacity,now});assert.equal(snapshot.system.cpuPercent,42);assert.equal(snapshot.activity.events.length,1);assert.equal(snapshot.activity.events[0].agent,'Claude');assert.equal(snapshot.capacity.Codex.status,'Available');assert.equal(snapshot.deliveredAt,new Date(now).toISOString());});

test('live transport carries the small normalized runtime catalog for post-scan lane hydration',()=>{const runtimeCatalog={liveRuntimes:[{id:'cline',agent:'Cline',host:'Cursor',liveCapable:true}]},snapshot=liveStateSnapshot({runtimeCatalog,now:4_000_000});assert.deepEqual(snapshot.runtimeCatalog,runtimeCatalog);assert.equal(JSON.stringify(snapshot).includes('prompt'),false);});
test('overview copy uses deterministic contextual, time, and non-repeating selection',()=>{let now=new Date('2026-08-13T09:00:00');while(Math.floor(now.getTime()/45_000)%3===2)now=new Date(now.getTime()+45_000);const summary={activity:[{agent:'Claude'},{agent:'Codex'},{agent:'Cursor'}],activeProjects:1,tokens:{}};const contextual=overviewCopy({now,summary,liveEvents:[{agent:'Claude',timestamp:now.toISOString()},{agent:'Codex',timestamp:now.toISOString()},{agent:'Cursor',timestamp:now.toISOString()}]});assert.equal(contextual.kind,'contextual');assert.match(contextual.message,/Three AIs/);const calm={activity:[{agent:'Claude'},{agent:'Codex'}],activeProjects:1,tokens:{}};const timed=overviewCopy({now,summary:calm,liveEvents:[]});assert.equal(timed.kind,'time');const next=overviewCopy({now:new Date(now.getTime()+45_000),summary:calm,liveEvents:[],lastMessage:timed.message});assert.notEqual(next.message,timed.message);});
test('share recaps filter today, month, and available tracking history without unsupported metrics',()=>{const now=new Date('2026-08-13T12:00:00Z'),index={summary:{},sessions:[{agent:'Claude',projectId:'p1',timestamp:'2026-08-13T01:00:00Z',tokens:{freshInput:10}},{agent:'Codex',projectId:'p2',timestamp:'2026-08-02T01:00:00Z',tokens:{output:4}},{agent:'Cursor',projectId:'p3',timestamp:'2026-07-20T01:00:00Z',tokens:{freshInput:9}}],capabilityUsageEvents:[{timestamp:'2026-08-13T02:00:00Z'}],efficiency:{components:{tokensPerSession:{comparable:false}}}};assert.equal(recapFor(index,'today',now).sessionCount,1);assert.equal(recapFor(index,'month',now).sessionCount,2);const all=recapFor(index,'all',now);assert.equal(all.sessionCount,3);assert.equal(all.title,'SINCE TRACKING BEGAN');const options=publicMetricOptions(index,'today',now);assert.equal(options.options.find(x=>x.id==='output').available,false);assert.equal(options.options.find(x=>x.id==='freshInput').available,true);});
test('detects Claude native auto-compact as a safe Automation',()=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'automation-'));fs.mkdirSync(path.join(home,'.claude'));fs.writeFileSync(path.join(home,'.claude','settings.json'),JSON.stringify({autoCompactEnabled:true,autoCompactWindow:300000,apiKey:'never-export'}));const raw=discoverNativeAutomations(home);assert.equal(raw.length,1);assert.equal(raw[0].type,'Automation');assert.equal(raw[0].scope,'User / Global');assert.match(raw[0].behavior,/300,000 tokens/);const grouped=groupCapabilities(raw,[])[0];assert.equal(grouped.type,'Automation');assert.equal(grouped.artifactState,'Complete');assert.equal(grouped.health,'Active');const index={summary:{agents:['Claude']},capabilities:[grouped]};const exported=JSON.stringify(shareableStack(index)),machine=JSON.stringify(manifest(index));assert.match(exported,/Claude Auto-Compact/);assert.match(machine,/autoCompactWindow/);assert.equal(exported.includes('apiKey'),false);assert.equal(machine.includes('apiKey'),false);assert.match(setupPrompt(index),/Verify the installed Claude Code version supports/);});
test('capacity normalization keeps native plan metadata separate and safe',()=>{const value=normalizeCapacity('Codex',{primary:{used_percent:23,window_minutes:10080,resets_at:1787201417},plan_type:'plus'},'2026-08-13T00:00:00Z');assert.equal(value.windows[0].remainingPercent,77);assert.equal(value.windows[0].label,'Weekly');assert.equal(value.status,'Available');assert.equal(normalizeCapacity('Claude',null).status,'Unavailable');const empty=fs.mkdtempSync(path.join(os.tmpdir(),'capacity-'));const local=JSON.stringify(readPlanCapacity(empty));assert.match(local,/Plan usage unavailable through a supported local source/);assert.equal(/token|cookie|password|credential/i.test(JSON.stringify(value)),false);});
test('capacity usage actions follow discovered source capability, not runtime state',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'capacity-actions-')),sourceStates={Claude:{installed:{state:'detected'}},Cursor:{history:{state:'observed'}}},capacity=readPlanCapacity(root,{sourceStates}),claude=capacity.providers.find(item=>item.provider==='Claude'),cursor=capacity.providers.find(item=>item.provider==='Cursor');assert.equal(claude.action?.href,'https://claude.ai/settings/usage');assert.equal(cursor.action?.href,'https://cursor.com/dashboard');assert.equal(readPlanCapacity(root).providers.find(item=>item.provider==='Cursor').action,undefined);const synthetic=readPlanCapacity(root,{sourceStates:{Synthetic:{installed:{state:'detected'}}},sources:[{id:'Synthetic',action:{id:'synthetic-usage',label:'Usage details',type:'external-url',href:'https://example.test/usage'},collect:()=>({provider:'Synthetic',status:'Unavailable',windows:[]})}]});assert.equal(synthetic.providers[0].action.label,'Usage details');});
test('hero copy remains fixed for one dashboard session',()=>{const input={now:new Date('2026-08-13T09:00:00'),summary:{activity:[{agent:'Claude'},{agent:'Codex'}],tokens:{}},resources:{},capabilities:[]},first=sessionOverviewCopy('',input),later=sessionOverviewCopy('Keep this exact line',{...input,now:new Date('2026-08-13T23:00:00')});assert.ok(first);assert.equal(later,'Keep this exact line');});
test('resume ranking prefers pins and waiting agents over recency alone',()=>{
  const now=Date.parse('2026-08-13T12:00:00Z');
  const pinned={id:'project:pin',name:'Pinned',pinned:true,status:null,git:{}};
  const waiting={id:'project:wait',name:'Waiting',pinned:false,status:'Active',git:{}};
  const archived={id:'project:old',name:'Archived',pinned:false,status:'Archived',git:{}};
  const sessions=[
    {projectId:'project:wait',agent:'Claude',timestamp:'2026-08-13T11:00:00Z',attributionConfidence:'Confirmed'},
    {projectId:'project:old',agent:'Codex',timestamp:'2026-08-13T11:50:00Z',attributionConfidence:'Confirmed'}
  ];
  const ranked=rankResumeCandidates([waiting,pinned,archived],sessions,{liveStates:{Claude:{state:'Needs You'}},now,limit:5});
  assert.equal(ranked[0].project.id,'project:pin');
  assert.equal(ranked.find(item=>item.project.id==='project:wait').waiting,true);
  assert.equal(ranked.some(item=>item.project.id==='project:old'),false);
});
test('last agent and observed context never include prompts',()=>{
  const project={id:'project:a',name:'Alpha',git:{branch:'main',lastCommitSubject:'Ship resume cards',dirty:true,recentFiles:['src/app.js']}};
  const sessions=[{projectId:'project:a',agent:'Codex',timestamp:'2026-08-13T10:00:00Z',attributionConfidence:'Confirmed',prompt:'never'}];
  const last=lastSessionForProject(sessions,'project:a');
  const text=observedContext({project,lastAgent:last.agent,agentState:{state:'Working'}});
  assert.equal(last.agent,'Codex');
  assert.match(text,/Codex/);
  assert.match(text,/main/);
  assert.match(text,/Ship resume cards/);
  assert.doesNotMatch(text,/never|prompt|transcript/i);
});
test('handoff markdown is compact, includes path, and strips secrets',()=>{
  const markdown=projectHandoff({
    name:'Alpha',
    canonicalPath:'/tmp/alpha',
    status:'Active',
    note:'Finish private QA.',
    git:{branch:'feat/resume',lastCommitHash:'abc123',lastCommitSubject:'Add operator surface',dirty:true,recentFiles:['src/resume.js','.env','secrets/token.json']}
  },{lastAgent:'Claude',agentState:{state:'Needs You'},capabilities:[{name:'investigate'}],includeNote:false});
  assert.match(markdown,/Path: \/tmp\/alpha/);
  assert.match(markdown,/Last Agent: Claude/);
  assert.match(markdown,/feat\/resume/);
  assert.match(markdown,/src\/resume\.js/);
  assert.doesNotMatch(markdown,/\.env|token\.json|Finish private QA|prompt|transcript/i);
});
test('open-agent constructs Cursor and Codex commands and reports missing Claude',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-'));
  const detected={platform:'darwin',Claude:{available:false,binary:null},Codex:{available:true,binary:'/opt/homebrew/bin/codex',kind:'cli'},Cursor:{available:true,binary:'/usr/local/bin/cursor',kind:'gui'}};
  const cursor=openAgentCommand('Cursor',dir,detected);
  const codex=openAgentCommand('Codex',dir,detected);
  const claude=openAgentCommand('Claude',dir,detected);
  assert.equal(cursor.ok,true);
  assert.deepEqual(cursor.argv,['/usr/local/bin/cursor',dir]);
  assert.equal(codex.ok,true);
  assert.equal(codex.argv[0],'osascript');
  assert.match(codex.argv.at(-1),/codex/);
  assert.equal(claude.ok,false);
  assert.match(claude.reason,/Claude Code CLI is not installed/);
});
test('Start Here prioritizes a verified attention state and stays honest about unknown quota',()=>{
  const waiting=startHereRecommendation({lastAgent:'Cursor',agentState:{state:'Needs You'}});
  const lastCodex=startHereRecommendation({lastAgent:'Codex',capacity:{providers:[{provider:'Codex',status:'Available',windows:[{label:'Weekly',remainingPercent:61}]}]}});
  const lastClaude=startHereRecommendation({lastAgent:'Claude',capacity:{providers:[{provider:'Codex',status:'Available',windows:[{label:'Weekly',remainingPercent:61}]}]}});
  assert.equal(waiting.agent,'Cursor');
  assert.match(waiting.reason,/needs your attention/);
  assert.equal(lastCodex.agent,'Codex');
  assert.match(lastCodex.reason,/61%/);
  assert.equal(lastClaude.agent,'Claude');
  assert.match(lastClaude.reason,/plan capacity is unknown locally/);
  assert.doesNotMatch(lastClaude.reason,/\$|USD|billed/i);
});
test('project roots can be configured and classify capabilities under those roots',()=>{
  const a=fixture(),b=fixture();
  const roots=resolveProjectRoots({env:{AI_DASHBOARD_PROJECTS_ROOT:`${a}:${b}`},homedir:'/tmp'});
  assert.deepEqual(roots,[a,b]);
  const projects=discoverProjects(roots);
  assert.equal(projects.length,2);
  const classified=classifyCapability({name:'Local skill',type:'Agent Skill',location:`${a}/alpha/.claude/skills/x/SKILL.md`},roots);
  assert.equal(classified.scope,'Project-specific');
});
test('observedModel reads later JSONL rows rather than only the first record',()=>{
  assert.equal(observedModel({message:{}}),null);
  assert.equal(observedModel({message:{model:'claude-opus-4'}}).model,'claude-opus-4');
  assert.equal(observedModel({payload:{model:'gpt-5'}}).model,'gpt-5');
  assert.equal(observedModel({model:'auto'}),null);
});
test('derive uses a cheap git snapshot and does not walk LOC',()=>{
  const root=fixture(),project=discoverProjects(root)[0];
  assert.equal(project.git.locDeferred,true);
  assert.equal(gitSnapshot(project.canonicalPath).linesMeasured,undefined);
  const result=derive({projects:[project],capabilities:[],capabilityUsageEvents:[],errors:[],sources:{projectsRoot:root},sessions:[]});
  assert.equal(result.projects[0].metrics.locDeferred,true);
  assert.equal(result.projects[0].metrics.linesMeasured,undefined);
});
test('share preview snapshots do not persist to disk',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'preview-')),now=new Date(),index={summary:{agents:['Claude']},sessions:[{agent:'Claude',timestamp:now.toISOString(),tokens:{freshInput:4}}],efficiency:{components:{}},capabilityUsageEvents:[]};
  createSnapshot(index,['sessions'],'1:1',dir,'month',{},{persist:false});
  assert.equal(fs.readdirSync(dir).length,0);
  const saved=createSnapshot(index,['sessions'],'1:1',dir,'month',{},{persist:true});
  assert.equal(fs.existsSync(path.join(dir,`${saved.id}.json`)),true);
});
test('achievement badges map to sliced PNG artwork families',()=>{
  const earned=achievementsFor({sessions:[{agent:'Claude',timestamp:'2026-08-01T00:00:00Z'},{agent:'Codex',timestamp:'2026-08-02T00:00:00Z'},{agent:'Claude',timestamp:'2026-08-03T00:00:00Z'},{agent:'Codex',timestamp:'2026-08-04T00:00:00Z'},{agent:'Claude',timestamp:'2026-08-05T00:00:00Z'},{agent:'Codex',timestamp:'2026-08-06T00:00:00Z'},{agent:'Claude',timestamp:'2026-08-07T00:00:00Z'}],summary:{capabilityUses:3}});
  const multi=earned.find(item=>item.id==='multi-agent-builder');
  assert.equal(multi.badge.kind,'artwork-png');
  assert.equal(multi.family,'multi-agent-mastery');
  assert.match(multi.badge.assetSlot,/assets\/achievements\/multi-agent-mastery\/bronze\.png/);
  assert.equal(fs.existsSync(path.join(process.cwd(),'public',multi.badge.assetSlot)),true);
});
test('cursor live allowlist rejects storage housekeeping and requires growing agent evidence',()=>{
  const wal='/Users/x/Library/Application Support/Cursor/User/globalStorage/state.vscdb-wal';
  const tool='/Users/x/.cursor/projects/foo/agent-tools/call.json';
  const transcript='/Users/x/.cursor/projects/foo/agent-transcripts/session.jsonl';
  assert.equal(isCursorLivePath(wal),false);
  assert.equal(isCursorLivePath(tool),true);
  assert.equal(isCursorLivePath(transcript),true);
  assert.equal(isCursorLivePath('/Users/x/.cursor/projects/foo/mcps/config.json'),false);
  assert.equal(isCursorLivePath('/Users/x/.cursor/projects/foo/canvases/board.json'),false);
  const source=fs.readFileSync(path.join(process.cwd(),'src','cli.js'),'utf8')+fs.readFileSync(path.join(process.cwd(),'src','live-files.js'),'utf8');
  assert.doesNotMatch(source,/better-sqlite|sql\.js|sqlite3|new Database/i);
  assert.equal(cursorLiveDecision(tool,{size:10,mtimeMs:1},{size:10,mtimeMs:99}).emit,false);
  assert.equal(cursorLiveDecision(tool,{size:10,mtimeMs:1},{size:20,mtimeMs:2}).emit,true);
  assert.equal(cursorLiveDecision(transcript,{size:10,mtimeMs:1},{size:98,mtimeMs:2},{transcriptHasAgentTurn:false}).emit,false);
  assert.equal(cursorLiveDecision(transcript,{size:98,mtimeMs:1},{size:180,mtimeMs:2},{transcriptHasAgentTurn:true}).emit,true);
});
test('claude live activity ignores dashboard-generated files and mtime-only touches',()=>{
  const session='/Users/x/.claude/projects/proj/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl';
  const subagent='/Users/x/.claude/projects/proj/agent-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl';
  const dashboard='/Users/x/.claude/ai-dashboard/events.jsonl';
  const usage='/Users/x/.claude/usage_state.json';
  const settings='/Users/x/.claude/settings.json';
  const backup='/Users/x/.claude/settings.json.bak-ai-dashboard-capacity';
  const capture='/Users/x/.claude/ai-dashboard/claude-capacity-capture.mjs';
  assert.equal(isClaudeLivePath(session),true);
  assert.equal(isClaudeLivePath(subagent),true);
  assert.equal(isClaudeLivePath(dashboard),false);
  assert.equal(isClaudeLivePath(usage),false);
  assert.equal(isClaudeLivePath(settings),false);
  assert.equal(isDashboardGeneratedClaudePath(dashboard),true);
  assert.equal(isDashboardGeneratedClaudePath(usage),true);
  assert.equal(isDashboardGeneratedClaudePath(backup),true);
  assert.equal(isDashboardGeneratedClaudePath(capture),true);
  assert.equal(claudeLiveDecision(dashboard,{size:10,mtimeMs:1},{size:999,mtimeMs:2}).emit,false);
  assert.equal(claudeLiveDecision(usage,null,{size:80,mtimeMs:2}).emit,false);
  assert.equal(claudeLiveDecision(session,{size:100,mtimeMs:1},{size:100,mtimeMs:99}).emit,false);
  assert.equal(claudeLiveDecision(session,{size:100,mtimeMs:1},{size:100,mtimeMs:99}).reason,'no-growth');
  assert.equal(claudeLiveDecision(session,{size:100,mtimeMs:1},{size:180,mtimeMs:2}).emit,true);
  assert.equal(claudeLiveDecision(session,null,{size:40,mtimeMs:1}).emit,true);
  assert.equal(claudeLiveDecision(session,{size:100,mtimeMs:1},null).emit,false);
  assert.equal(claudeLiveDecision(session,{size:100,mtimeMs:1},null).keep,false);
  const cli=fs.readFileSync(path.join(process.cwd(),'src','cli.js'),'utf8');
  assert.match(cli,/claudeLiveDecision/);
  assert.match(cli,/observeLivePath/);
  assert.doesNotMatch(cli,/ai-dash-claude-live/);
});
test('maintenance surfaces duplicates without turning unused capabilities into an app store',()=>{
  const groups=maintenanceGroups([
    {id:'a',name:'Investigate',groupKey:'skill:investigate-a',type:'Skills',scope:'Shared',artifactState:'Complete',health:'No observed use',updateStatus:'Update status unknown',agentCoverage:[]},
    {id:'b',name:'Investigate',groupKey:'skill:investigate-b',type:'Skills',scope:'Shared',artifactState:'Complete',health:'No observed use',updateStatus:'Update status unknown',agentCoverage:[]},
    {id:'c',name:'Broken skill',type:'Skills',scope:'Shared',artifactState:'Broken',health:'No observed use',updateStatus:'Update status unknown',agentCoverage:[]}
  ]);
  assert.equal(groups.duplicates.length,1);
  assert.equal(groups.needsAction.length,1);
  const ui=fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8');
  assert.match(ui,/Usage review/);
  assert.match(ui,/does not install or sync skills/);
});
test('tool and upstream repositories stay attributable but are excluded from primary projects',()=>{
  const tool=classifyRepository({canonicalPath:'/Users/x/Dropbox/Projects/Tools/watermarks-remover'}),reference=classifyRepository({canonicalPath:'/Users/x/Dropbox/Projects/multistream/.upstream-reference'}),work=classifyRepository({canonicalPath:'/Users/x/Dropbox/Projects/Product'});
  assert.equal(tool.repositoryClass,'Tool');assert.equal(reference.repositoryClass,'Reference');assert.equal(work.repositoryClass,'Project');
  const decorated=applyProjectMetadata({repositories:[{id:'tool',name:'Tool',...tool},{id:'reference',name:'Reference',...reference},{id:'work',name:'Work',...work}],projects:[]},{projects:{tool:{repositoryClass:'Project'}}});
  assert.deepEqual(decorated.projects.map(x=>x.id),['tool','work']);
});
test('capability detail aggregation and duplicate investigation avoid repeated raw rows',()=>{
  const grouped=groupCapabilities([{id:'one',name:'Impeccable',type:'Agent Skill',origin:'Claude user',location:'/Users/x/.claude/skills/impeccable/SKILL.md',sourceHash:'same',sourceHashKind:'content'},{id:'two',name:'Impeccable',type:'Agent Skill',origin:'Claude user',location:'/Users/x/.claude/skills/impeccable/copy/SKILL.md',sourceHash:'same',sourceHashKind:'content'}],[])[0];
  assert.equal(grouped.componentGroups.length,1);assert.equal(grouped.componentGroups[0].count,2);
  const findings=duplicateInvestigations([{...grouped,id:'a',groupKey:'skill:a'},{...grouped,id:'b',groupKey:'skill:b'}]);
  assert.equal(findings[0].kind,'Exact duplicate');assert.equal(findings[0].items.length,2);
});
test('registry defaults keep instructions out of reusable functionality and preserve back navigation',()=>{
  const ui=fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8');
  assert.match(ui,/All functionality/);assert.match(ui,/instructionsByScope/);assert.match(ui,/data-back="capabilities"/);assert.match(ui,/Repository type/);
});
test('the browser entry module parses before it is served',()=>{
  for (const file of ['app.js','live-ui.js','resume-ui.js','agent-state.js','signal-field.js']) {
    assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',path.join(process.cwd(),'public',file)],{stdio:'pipe'}));
  }
  assert.match(fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8'),/function activateView\(next\)\{[\s\S]*?if\(data\)render\(\)/);
});
test('utility launchers stay usable as drawer toggles',()=>{
  const ui=fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8');
  const css=fs.readFileSync(path.join(process.cwd(),'public','overrides.css'),'utf8');
  assert.match(ui,/classList\.add\('utility-open'\)/);
  assert.match(ui,/classList\.remove\('utility-open'\)/);
  assert.match(css,/body\.utility-open \.actions/);
});
test('overview is an operator surface with resume, needs you, and start here',()=>{
  const source=fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8')+fs.readFileSync(path.join(process.cwd(),'public','live-ui.js'),'utf8')+fs.readFileSync(path.join(process.cwd(),'public','brands.js'),'utf8')+fs.readFileSync(path.join(process.cwd(),'public','index.html'),'utf8');
  assert.match(source,/Needs You/);
  assert.match(source,/Continue Working/);
  assert.match(source,/Start Here/);
  assert.match(source,/data-view="live"/);
  assert.match(source,/Live Feed/);
  assert.match(source,/Resume Context/);
  assert.match(source,/preview:true/);
  assert.match(source,/laneH/);
  assert.match(source,/#2EE6C3/);
});
test('operator UI keeps verified attention, separate row fields, and expandable context',()=>{const source=fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8')+fs.readFileSync(path.join(process.cwd(),'public','live-ui.js'),'utf8'),styles=fs.readFileSync(path.join(process.cwd(),'public','overrides.css'),'utf8');assert.match(source,/Only explicit, supported local attention signals/);assert.match(source,/class="waiting-project"/);assert.match(source,/class="waiting-agent-name"/);assert.match(source,/class="waiting-state"/);assert.match(source,/data-expand-context/);assert.match(source,/View context/);assert.match(styles,/\.waiting-row\{display:grid/);assert.match(styles,/grid-template-columns:var\(--icon-box\) minmax\(0,1fr\) max-content max-content/);assert.match(styles,/\.resume-card\{display:flex;flex-direction:column/);assert.match(styles,/\.resume-card \.resume-actions\{margin-top:auto/);});
test('shared dashboard primitives keep controls, metadata, and attention rows structurally aligned',()=>{const styles=fs.readFileSync(path.join(process.cwd(),'public','overrides.css'),'utf8');assert.match(styles,/--panel-inset:20px/);assert.match(styles,/--control-height:42px/);assert.match(styles,/--badge-height:22px/);assert.match(styles,/\.primary,\.filter\{display:inline-flex;align-items:center;justify-content:center;min-height:var\(--control-height\)/);assert.match(styles,/\.waiting-state\{display:grid;justify-items:end/);});
test('resume context preserves all content while offering controlled expansion',()=>{const short=resumeContextPresentation('Short context.'),longText='A'.repeat(230),long=resumeContextPresentation(longText),expanded=resumeContextPresentation(longText,true);assert.equal(short.expandable,false);assert.equal(long.expandable,true);assert.equal(long.text,longText);assert.equal(expanded.expanded,true);assert.equal(expanded.text,longText);});

test('Start Here and Needs You share a two-column operator desk',()=>{
  const styles=fs.readFileSync(path.join(process.cwd(),'public','overrides.css'),'utf8');
  const ui=fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8')+fs.readFileSync(path.join(process.cwd(),'public','live-ui.js'),'utf8');
  assert.match(styles,/\.operator-desk\{display:grid/);
  assert.match(styles,/grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(styles,/@media\(max-width:880px\)\{\.operator-desk\{grid-template-columns:1fr\}/);
  const empty=needsYouPanel([]);
  const one=needsYouPanel([{agent:'Codex',projectName:'Alpha',projectId:'p1',waitingMs:1000}]);
  const many=needsYouPanel([{agent:'Codex',projectName:'Alpha',projectId:'p1'},{agent:'Claude',projectName:'Beta',projectId:'p2'}]);
  assert.match(empty,/Nothing needs your attention right now/);
  assert.match(one,/Alpha/);
  assert.doesNotMatch(one,/needs-you-more/);
  assert.match(many,/needs-you-more/);
  const card=startHereCard({project:{id:'p1',name:'AI Development Dashboard'},recommendation:{agent:'Codex',reason:'Codex was last used here and has 36% of its weekly window remaining.'},lastAgent:'Codex'});
  assert.match(card,/Continue in Codex/);
  assert.match(card,/36%/);
  assert.match(ui,/operator-desk/);
});

test('token periods use local time and do not treat Cursor zeros as usage',()=>{
  const now=new Date(2026,7,15,21,30,0);
  const todayStart=periodBounds('today',now).start;
  const yesterdayStart=periodBounds('yesterday',now).start;
  const todayAt=new Date(todayStart.getTime()+3_600_000).toISOString();
  const yesterdayAt=new Date(yesterdayStart.getTime()+3_600_000).toISOString();
  const todayKey=localDateKey(todayStart);
  const yesterdayKey=localDateKey(yesterdayStart);
  const day=(date,tokens,at)=>({date,tokens,eventCount:1,firstAt:at,lastAt:at});
  const sessions=[
    {agent:'Claude',host:'Claude Code',provider:'Anthropic',model:'claude-opus-4',timestamp:todayAt,tokens:{freshInput:100,output:20,cacheRead:400,cacheCreation:10,reasoning:0,other:0},tokenDays:{[todayKey]:day(todayKey,{freshInput:100,output:20,cacheRead:400,cacheCreation:10,reasoning:0,other:0},todayAt)}},
    {agent:'Codex',host:'Codex CLI',provider:'OpenAI',model:'gpt-5.6',timestamp:yesterdayAt,tokens:{freshInput:50,output:10,cacheRead:0,cacheCreation:0,reasoning:0,other:0},tokenDays:{[yesterdayKey]:day(yesterdayKey,{freshInput:50,output:10,cacheRead:0,cacheCreation:0,reasoning:0,other:0},yesterdayAt)}},
    {agent:'Cursor',host:'Cursor',provider:'Unknown',model:null,timestamp:new Date(todayStart.getTime()+2_000_000).toISOString(),tokens:{freshInput:0,output:0,cacheRead:0,cacheCreation:0,reasoning:0,other:0}}
  ];
  const {reports}=tokenReports(sessions,now,{knownAgents:['Claude','Codex','Cursor']});
  assert.equal(reports.today.tokens.freshInput,100);
  assert.equal(reports.today.observedActivity,530);
  assert.equal(reports.yesterday.tokens.freshInput,50);
  assert.equal(reports['7d'].sessionCount,2);
  assert.equal(reports.month.sessionCount,2);
  assert.equal(reports.all.sessionCount,2);
  const cursor=reports.today.byAgent.find(row=>row.agent==='Cursor');
  const claude=reports.today.byAgent.find(row=>row.agent==='Claude');
  assert.equal(cursor.available,false);
  assert.equal(cursor.observedActivity,null);
  assert.match(cursor.reason,/Local token telemetry unavailable/);
  assert.equal(claude.available,true);
  assert.equal(Math.round(claude.share*100),100);
  assert.equal(localDateKey(now),'2026-08-15');
  assert.equal(periodBounds('yesterday',now).end.getTime(),todayStart.getTime());
});

test('derive hydrates host and provider on older sessions without inventing roles',()=>{
  const tokens={freshInput:1,output:1,cacheRead:0,cacheCreation:0,reasoning:0,other:0};
  const r=derive({projects:[],capabilities:[],capabilityUsageEvents:[],errors:[],sources:{},sessions:[{id:'old',agent:'Claude',model:'kimi-k3',timestamp:'2026-08-10T00:00:00Z',tokens,tools:0,compactions:0,attributionConfidence:CONFIDENCE.unknown}]});
  assert.equal(r.sessions[0].agent,'Kimi');
  assert.equal(r.sessions[0].host,'Claude Code');
  assert.equal(r.sessions[0].provider,'Moonshot');
  assert.equal(r.sessions[0].role,null);
  assert.ok(r.summary.providers.includes('Moonshot'));
  assert.ok(r.summary.hosts.includes('Claude Code'));
});

test('model provider and host stay separate and roles are never invented',()=>{
  const kimi=sessionIdentity({agent:'Claude',host:'Claude Code',model:'kimi-k3'});
  assert.equal(kimi.agent,'Kimi');
  assert.equal(kimi.host,'Claude Code');
  assert.equal(kimi.provider,'Moonshot');
  assert.equal(kimi.role,null);
  assert.equal(inferAgentFromModel('deepseek-v4-flash','Claude'),'DeepSeek');
  assert.equal(inferProvider('gpt-5.6').provider,'OpenAI');
  const run=emptyHarnessRun({harness:'custom-harness',task:'Live Feed',workers:[harnessWorker({agent:'Kimi',host:'Kimi Code',provider:'Moonshot',model:'kimi-k3',role:'Implementation'})]});
  assert.equal(run.workers[0].role,'Implementation');
  assert.equal(emptyHarnessRun().workers.length,0);
  const source=fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8');
  assert.match(source,/<dt>Host<\/dt>/);
  assert.match(source,/<dt>Provider<\/dt>/);
  assert.match(source,/<dt>Role<\/dt>/);
  assert.match(source,/Not recorded/);
});

test('footer omits the public source link while the repository is private',()=>{
  const privateRelease=releaseInfo({repositoryPublic:false});
  const publicRelease=releaseInfo({repositoryPublic:true});
  const defaultRelease=releaseInfo({});
  assert.equal(privateRelease.sourceUrl,null);
  assert.equal(publicRelease.sourceUrl,'https://github.com/designdelulu/AI-Development-Dashboard');
  assert.equal(defaultRelease.sourceUrl,'https://github.com/designdelulu/AI-Development-Dashboard');
  assert.doesNotMatch(footerMarkup(privateRelease),/github.com/);
  assert.match(footerMarkup(publicRelease),/github.com\/designdelulu\/AI-Development-Dashboard/);
  assert.match(footerMarkup(privateRelease),/ericbarker\.co/);
  assert.match(footerMarkup(privateRelease),/ai-development-dashboard\.html/);
  const html=fs.readFileSync(path.join(process.cwd(),'public','index.html'),'utf8');
  assert.doesNotMatch(html,/href="https:\/\/github.com\/designdelulu\/AI-Development-Dashboard"/);
});

test('fresh clones do not assume a Dropbox projects root',()=>{
  const roots=resolveRoots({env:{},homedir:'/tmp/no-dashboard-home',settings:{}});
  assert.deepEqual(roots,[]);
  assert.equal(detectProjectRoots('/tmp/no-dashboard-home').length,0);
  const ui=fs.readFileSync(path.join(process.cwd(),'public','live-ui.js'),'utf8');
  assert.match(ui,/Choose a projects folder/);
  assert.match(ui,/Dropbox is not required/);
});

test('public-release privacy validator flags secrets and owner paths in source',()=>{
  assert.equal(auditText('const x=1;','src/ok.js').length,0);
  assert.ok(auditText('sk-ant-api03-abcdefghijklmnopqrstuvwxyz','src/leak.js').some(item=>item.kind==='secret'));
  assert.ok(auditText("const root='/Users/ericbarker/Dropbox/Projects';",'src/config.js').some(item=>item.kind==='absolute-owner-path'));
  const tracked=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const findings=auditTree(process.cwd(),tracked).filter(item=>item.kind==='secret'||item.kind==='env-file'||item.kind==='local-analytics'||item.kind==='handoff');
  assert.deepEqual(findings,[]);
});

test('Live Feed keeps the validated telemetry surface out of Overview',()=>{
  const app=fs.readFileSync(path.join(process.cwd(),'public','app.js'),'utf8');
  const html=fs.readFileSync(path.join(process.cwd(),'public','index.html'),'utf8');
  assert.match(html,/<button data-view="live">Live Feed <span class="live-feed-signal"/);
  assert.match(app,/requestedView\(/);
  assert.match(app,/\?view=/);
  assert.match(app,/function liveFeed\(/);
  assert.match(app,/tokenModule\(/);
  assert.match(app,/view==='live'\)liveFeed/);
  const liveFn=app.slice(app.indexOf('function liveFeed('),app.indexOf('function bindTokenModule('));
  assert.ok(liveFn.indexOf('tokenModule(')<liveFn.indexOf('capacityPanel()'),'Token Activity should render before Plan Capacity');
  assert.ok(liveFn.indexOf('live-instrument')<liveFn.indexOf('tokenModule('),'Live Agent Activity should render before Token Activity');
  assert.ok(liveFn.indexOf('capacityPanel()')<liveFn.indexOf('resource-panel'),'Plan Capacity should render before System Resources');
  assert.ok(liveFn.indexOf('resource-panel')<liveFn.indexOf('overview-strip'),'System Resources should render before remaining secondary telemetry');
  assert.ok(liveFn.indexOf('live-instrument')<liveFn.indexOf('resource-panel'));
  assert.ok(!/live-instrument[\s\S]*resource-strip[\s\S]*tokenModule/.test(liveFn),'System Resources must not sit inside Live Agent Activity');
  const overviewFn=app.slice(app.indexOf('function overview('),app.indexOf('function liveFeed('));
  assert.doesNotMatch(overviewFn,/activity-monitor/);
  assert.doesNotMatch(overviewFn,/capacityPanel/);
  assert.match(fs.readFileSync(path.join(process.cwd(),'public','live-ui.js'),'utf8'),/TOKEN ACTIVITY/);
  assert.match(fs.readFileSync(path.join(process.cwd(),'public','overrides.css'),'utf8'),/@media\(max-width:1100px\)\{[^@]*capacity-layout\{grid-template-columns:1fr\}/);
  assert.match(app,/state\.runtimeCatalog/);
  assert.match(app,/hadLanes=currentLanes\(\)\.length/);
});

test('token module markup stays honest about cache and unavailable agents',()=>{
  const html=tokenModule({label:'Today',observedActivity:530,freshPlusOutput:120,tokens:{freshInput:100,output:20,cacheRead:400,cacheCreation:10},byAgent:[{agent:'Claude',available:true,observedActivity:530,share:1},{agent:'Cursor',available:false,reason:'Local token telemetry unavailable'}]},{selected:'today',yesterday:{observedActivity:60},expanded:true});
  assert.match(html,/observed token activity/);
  assert.match(html,/Fresh \+ Output · Today/);
  assert.match(html,/Local token telemetry unavailable/);
  assert.doesNotMatch(html,/>Tokens Used</);
  assert.doesNotMatch(html,/>Unavailable</);
});
