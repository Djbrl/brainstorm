import React from 'react';
import {AbsoluteFill, Composition, Easing, cancelRender, continueRender, delayRender, interpolate, registerRoot, staticFile, useCurrentFrame} from 'remotion';

// Fonts are local and explicitly awaited: no fallback-font frames in the export.
if (typeof document !== 'undefined') {
  const handle=delayRender('Load Fontshare fonts');
  Promise.all([
    ['Cabinet Grotesk','cabinet-grotesk-700.woff2','700'],
    ['Cabinet Grotesk','cabinet-grotesk-800.woff2','800'],
    ['Satoshi','satoshi-400.woff2','400'],
    ['Satoshi','satoshi-500.woff2','500'],
  ].map(async ([family,file,weight])=>{
    const face=await new FontFace(family,`url(${staticFile('fonts/'+file)})`,{weight}).load();
    document.fonts.add(face);
  })).then(()=>continueRender(handle)).catch(cancelRender);
}

const C={paper:'#FFFFFF',alt:'#F5F5F7',ink:'#1D1D1F',muted:'#6E6E73',line:'#E3E3E8',green:'#76B900',blue:'#0A84FF',purple:'#BF5AF2',cyan:'#30B0C7',orange:'#FF9F0A',hot:'#FF375F'};
const grad:React.CSSProperties={background:'linear-gradient(95deg,#3f8c00,#76b900 55%,#9ccc1c)',backgroundClip:'text',WebkitBackgroundClip:'text',color:'transparent'};
const ease=(f:number,a:number,d=35)=>interpolate(f,[a,a+d],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.2,.7,.1,1)});
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const Head:React.FC<{children:React.ReactNode,style?:React.CSSProperties}>=({children,style})=><div style={{fontFamily:'Cabinet Grotesk',fontWeight:800,fontSize:137,lineHeight:.98,letterSpacing:-5,...style}}>{children}</div>;
const Rise:React.FC<{f:number,at?:number,children:React.ReactNode,style?:React.CSSProperties}>=({f,at=0,children,style})=><div style={{opacity:ease(f,at),transform:`translateY(${(1-ease(f,at))*60}px)`,...style}}>{children}</div>;
const Center:React.FC<{children:React.ReactNode}>=({children})=><AbsoluteFill style={{alignItems:'center',justifyContent:'center',textAlign:'center'}}>{children}</AbsoluteFill>;
const graphNodes=Array.from({length:72},(_,i)=>{const cluster=Math.floor(i/6),j=i%6,a=j*1.17+cluster*.7,r=j===0?0:45+(i*17%55);return {x:315+(cluster%4)*420+Math.cos(a)*r,y:230+Math.floor(cluster/4)*285+Math.sin(a)*r,r:5+i%7};});
const graphEdges=graphNodes.flatMap((_,i)=>i%6?[[i-i%6,i]]:i<66?[[i,i+6]]:[]);
function MapGraphic({f,large=false}:{f:number,large?:boolean}){return <svg width="1920" height="1080" style={{position:'absolute',inset:0,transform:large?'scale(.85)':'none'}}>
 {graphEdges.map(([a,b],i)=><line key={i} x1={graphNodes[a].x} y1={graphNodes[a].y} x2={graphNodes[b].x} y2={graphNodes[b].y} stroke="#C8CFD9" strokeWidth={1.6} opacity={ease(f,i%20,40)*.6}/>)}
 {graphNodes.map((n,i)=>{const col=i%19===0?C.hot:i%9===0?C.orange:'#B4C2D4';return <g key={i} opacity={ease(f,i%25,35)}>{i%19===0&&<circle cx={n.x} cy={n.y} r={n.r+10+Math.sin(f/15+i)*4} fill="#FF375F12"/>}<circle cx={n.x} cy={n.y} r={n.r} fill={col}/></g>})}
 </svg>}
function Trails({f}:{f:number}){
 const zoom=ease(f,125,100),title=f<62?'One agent, you can follow.':f<160?"Three, you can’t.":'Brainstorm shows you where.';
 return <><div style={{position:'absolute',inset:0,opacity:zoom}}><MapGraphic f={f-120}/></div><svg width="1920" height="1080" style={{position:'absolute',inset:0}}>{[C.blue,C.purple,C.cyan].map((col,i)=>{const p=ease(f,i===0?0:52+i*10,115),points=Array.from({length:90},(_,j)=>{const t=j/89;return {x:-100+t*1700,y:470+(i-1)*135*(i?1:0)+Math.sin(t*6.28+i)*85*(i?1:0)+Math.sin(t*12)*100*zoom};});const count=Math.max(1,Math.floor(p*89)),head=points[count];return <g key={col} opacity={p>0?1:0}><polyline points={points.slice(0,count+1).map(n=>`${n.x},${n.y}`).join(' ')} fill="none" stroke={col} strokeWidth={4} strokeLinecap="round"/><circle cx={head.x} cy={head.y} r={18} fill={col} opacity={.1}/><circle cx={head.x} cy={head.y} r={7} fill={col}/><text x={head.x+22} y={head.y-22} fill={C.ink} fontFamily="Satoshi" fontSize={25}>Agent {i+1}</text></g>})}</svg><div style={{position:'absolute',bottom:110,left:0,right:0,textAlign:'center',background:'#FFFFFFD9',padding:20}}><Head style={{fontSize:87,letterSpacing:-3}}>{title}</Head></div></>
}
function Product({f}:{f:number}){
 const shift=ease(f,115,25)+ease(f,255,25);
 const page=Math.round(shift);
 return <><div style={{position:'absolute',top:86,width:'100%',textAlign:'center'}}><Head style={{fontSize:110}}>Follow. Ask. <span style={grad}>Zoom out.</span></Head></div>
 <div style={{position:'absolute',left:260-shift*1530,top:295,display:'flex',gap:130}}>{[0,1,2].map(i=><div key={i} style={{position:'relative',width:1400,height:630,background:'white',borderRadius:22,boxShadow:'0 30px 70px #0000000A',overflow:'hidden'}}>
 <div style={{height:72,borderBottom:'1px solid #EEEEF2',padding:'20px 40px',display:'flex',gap:55,fontSize:24}}><b style={{fontFamily:'Cabinet Grotesk'}}>Brainstorm</b><span style={{color:i===0?C.blue:C.muted}}>Follow</span><span style={{color:i===2?C.blue:C.muted}}>Map</span></div>
 {i===0&&<div style={{padding:'42px 65px'}}><Head style={{fontSize:50,letterSpacing:-1}}>Add payment verification</Head><div style={{position:'relative',marginTop:45,paddingLeft:40,borderLeft:'2px solid #DFE2E8'}}>{['Read checkout handler','Verified webhook signature','Added validation tests'].map((s,j)=><div key={s} style={{fontSize:29,marginBottom:32,color:j===1?C.blue:C.muted}}>{s}{j===1&&<div style={{fontSize:22,fontFamily:'monospace',color:'#548453',lineHeight:1.7,marginTop:16}}>+ verifySignature(request)<br/>+ await processPayment(event)</div>}</div>)}</div></div>}
 {i===1&&<div style={{padding:'65px 90px'}}><Head style={{fontSize:65,letterSpacing:-2}}>Ask why.</Head><div style={{marginTop:40,fontSize:34}}>Why verify the signature here?</div><div style={{marginTop:35,fontSize:31,lineHeight:1.5,color:C.muted,maxWidth:1120}}>It checks that the webhook came from the payment provider before processing the event.</div><div style={{marginTop:40,fontSize:22,color:'#96969E'}}>Illustrative answer · replace with a real Ask recording</div></div>}
 {i===2&&<div style={{position:'absolute',left:-260,top:5,transform:'scale(.7)',transformOrigin:'center 20%'}}><MapGraphic f={Math.max(50,f-280)}/></div>}
 </div>)}</div><div style={{position:'absolute',bottom:57,width:'100%',textAlign:'center',fontSize:29,color:C.muted}}>{['Open the edit.','Understand the decision.','See the whole project.'][page]}</div></>
}
function LocalFlow({f}:{f:number}){
 const xs=[245,700,1170,1630];
 return <><Rise f={f} style={{position:'absolute',top:115,width:'100%',textAlign:'center'}}><Head style={{fontSize:125}}>Built around<br/>your machine.</Head></Rise><svg width="1920" height="1080" style={{position:'absolute',inset:0}}>{[0,1,2].map((i)=><g key={i}><line x1={xs[i]+65} y1={640} x2={xs[i+1]-65} y2={640} stroke={C.line} strokeWidth={3}/><circle cx={mix(xs[i]+65,xs[i+1]-65,((f+i*30)%100)/100)} cy={640} r={7} fill={C.blue} opacity={ease(f,i*25)}/></g>)}</svg>
 {['Logs + files','Listener + mapper','SQLite','Live map'].map((s,i)=><Rise key={s} f={f} at={i*22} style={{position:'absolute',left:xs[i]-190,top:574,width:380,textAlign:'center'}}><div style={{height:128,width:128,margin:'0 auto',borderRadius:64,background:i===2?'#E8F0DD':'#F5F5F7',display:'grid',placeItems:'center',fontSize:43,color:i===2?'#60920B':C.muted}}>{['{ }','↗','≡','⋈'][i]}</div><div style={{fontSize:30,marginTop:32}}>{s}</div></Rise>)}
 <div style={{position:'absolute',bottom:103,width:'100%',textAlign:'center',fontSize:27,color:C.muted,opacity:ease(f,150)}}>Session logs + imports + git → stored locally.</div></>
}
function Models({f}:{f:number}){return <><Rise f={f} style={{position:'absolute',top:107,width:'100%',textAlign:'center'}}><Head style={{fontSize:121}}>The right model<br/>for each job.</Head></Rise><div style={{position:'absolute',left:180,right:180,top:470,display:'grid',gridTemplateColumns:'1fr 1fr',gap:150}}>{[{name:'Nemotron',sub:'on NVIDIA Brev',color:C.green,top:'Code + agent actions',bottom:'Summaries + step labels'},{name:'Claude',sub:'via your API key',color:'#D97757',top:'Selected step + diff',bottom:'A grounded explanation'}].map((m,i)=><Rise key={m.name} f={f} at={i*70} style={{textAlign:'center'}}><div style={{fontSize:29,color:C.muted}}>{m.top}</div><div style={{fontSize:39,color:'#D0D0D6',margin:'22px 0'}}>↓</div><Head style={{fontSize:89,letterSpacing:-3,color:m.color}}>{m.name}</Head><div style={{fontSize:25,marginTop:16,color:C.muted}}>{m.sub}</div><div style={{fontSize:39,color:'#D0D0D6',margin:'22px 0'}}>↓</div><div style={{fontSize:31}}>{m.bottom}</div></Rise>)}</div></>}
function Benchmark({f}:{f:number}){return <><Rise f={f} style={{position:'absolute',top:130,width:'100%',textAlign:'center'}}><Head style={{fontSize:130}}>One GPU.<br/><span style={grad}>Measured.</span></Head></Rise><div style={{position:'absolute',left:170,right:170,top:475,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:50,textAlign:'center'}}>{[['311','files summarized'],['73.2s','elapsed time'],['2.2¢','GPU run cost']].map(([n,label],i)=><Rise f={f} at={20+i*25} key={label}><Head style={{fontSize:158,letterSpacing:-6,...(i===2?grad:{})}}>{n}</Head><div style={{fontSize:30,color:C.muted,marginTop:30}}>{label}</div></Rise>)}</div><div style={{position:'absolute',top:790,width:'100%',textAlign:'center',fontSize:29,color:C.muted,opacity:ease(f,130)}}>646,453 input tokens · 20,460 output tokens</div><div style={{position:'absolute',bottom:74,width:'100%',textAlign:'center',fontSize:23,color:C.muted,lineHeight:1.6}}>Hono · Nemotron 3 Nano · L40S at $1.06/hour · 16 parallel requests<br/>Inference time only; excludes startup and idle time. Input capped at 60,000 characters per file.</div></>}
function Film(){
 const f=useCurrentFrame();const starts=[0,180,420,600,930,1350,1620,1950,2310,2490];let s=0;for(let i=0;i<starts.length;i++)if(f>=starts[i])s=i;const t=f-starts[s];
 return <AbsoluteFill style={{background:[3,4,5,8,9].includes(s)?C.alt:C.paper,color:C.ink,fontFamily:'Satoshi',overflow:'hidden'}}>
 {s===0&&<Center><Rise f={t}><Head style={{fontSize:236,letterSpacing:-11}}>A live map<br/><span style={grad}>of your code.</span></Head></Rise><Rise f={t} at={22} style={{fontSize:43,color:C.muted,marginTop:55}}>And of the AI agents writing it.</Rise></Center>}
 {s===1&&<Trails f={t}/>}
 {s===2&&<><div style={{position:'absolute',top:-t*4,left:550,fontFamily:'monospace',fontSize:25,lineHeight:2.2,color:'#B2B5BB',opacity:1-ease(t,55,70)*.85}}>{Array.from({length:40},(_,i)=><div key={i}><span style={{color:'#57A055'}}>●</span> {['Update','Edit','Write'][i%3]}(src/{['auth/session.ts','api/billing.ts','db/schema.ts','lib/retry.ts'][i%4]})</div>)}</div><Center><Rise f={t} at={60}><Head style={{fontSize:157,background:'#FFFFFFE8',padding:'30px 45px'}}>Nobody reads this.</Head></Rise></Center></>}
 {s===3&&<><Rise f={t} style={{position:'absolute',top:130,width:'100%',textAlign:'center'}}><Head style={{fontSize:125}}>{t<210?'Understanding matters.':'Ask to understand.'}</Head></Rise><div style={{position:'absolute',left:340,right:340,top:410,display:'flex',justifyContent:'space-between',textAlign:'center'}}>{[['50%','with AI'],['67%','without AI']].map(([v,l],i)=><Rise key={v} f={t} at={i*24}><Head style={{fontSize:230,letterSpacing:-10,...(i===1?grad:{})}}>{v}</Head><div style={{fontSize:34,marginTop:25,color:C.muted}}>{l}</div></Rise>)}</div><div style={{position:'absolute',bottom:93,left:0,right:0,textAlign:'center',fontSize:24,lineHeight:1.6,color:C.muted}}>Comprehension quiz · 52 developers learning one Python library<br/>Anthropic, January 2026 · Explanation-seeking was associated with stronger understanding.</div></>}
 {s===4&&<Product f={t}/>}
 {s===5&&<LocalFlow f={t}/>}
 {s===6&&<Models f={t}/>}
 {s===7&&<Benchmark f={t}/>}
 {s===8&&<Center><Rise f={t}><Head style={{fontSize:120}}>Read once.<br/><span style={grad}>Re-read changes.</span></Head></Rise><Rise f={t} at={35} style={{display:'flex',gap:22,marginTop:65}}>{Array.from({length:11},(_,i)=><div key={i} style={{height:55,width:36,borderRadius:5,border:`2px solid ${i===6?C.green:'#D6D8DF'}`,background:i===6?'#EAF3DA':'transparent',transform:`translateY(${i===6?-15*ease(t,50):0}px)`}}/>)}</Rise><Rise f={t} at={75} style={{fontSize:34,marginTop:53,color:C.muted}}>The map: <span style={{color:C.ink}}>0 model tokens.</span></Rise></Center>}
 {s===9&&<Center><Rise f={t}><Head style={{fontSize:138,letterSpacing:-6}}>Let the agents type.</Head></Rise><Rise f={t} at={28}><Head style={{fontSize:138,letterSpacing:-6,marginTop:25,...grad}}>Keep your brain<br/>in the loop.</Head></Rise><Rise f={t} at={65} style={{fontFamily:'Cabinet Grotesk',fontSize:38,fontWeight:800,marginTop:65}}>Brainstorm.</Rise></Center>}
 </AbsoluteFill>;
}
registerRoot(()=> <Composition id="Film" component={Film} durationInFrames={2700} fps={30} width={1920} height={1080}/>);
