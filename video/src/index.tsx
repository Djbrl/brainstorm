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

const C={paper:'#FAFAF8',ink:'#222326',muted:'#777980',violet:'#7759CF',line:'#D6D5DF'};
const ease=(f:number,start:number,d=30)=>interpolate(f,[start,start+d],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.22,1,.36,1)});
const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
const H:React.FC<{children:React.ReactNode,style?:React.CSSProperties}>=({children,style})=><div style={{fontFamily:'Cabinet Grotesk',fontSize:170,fontWeight:700,lineHeight:1.03,letterSpacing:-7,...style}}>{children}</div>;
const Reveal:React.FC<{f:number,at?:number,children:React.ReactNode,style?:React.CSSProperties}>=({f,at=0,children,style})=>{const p=ease(f,at);return <div style={{opacity:p,transform:`translateY(${(1-p)*65}px)`,...style}}>{children}</div>};
const files=['auth/session.ts','payments/webhook.ts','web/Dashboard.tsx','api/router.ts','data/schema.ts','tests/auth.test.ts','lib/checkout.ts','web/Settings.tsx','server/index.ts','hooks/useSession.ts','styles/theme.css','lib/validate.ts'];
const nodes=[{x:960,y:625,r:26},{x:630,y:440,r:18},{x:1270,y:435,r:19},{x:610,y:805,r:21},{x:1280,y:800,r:18},{x:930,y:310,r:14},{x:355,y:370,r:10},{x:355,y:585,r:12},{x:370,y:850,r:11},{x:710,y:1020,r:10},{x:1130,y:995,r:12},{x:1570,y:875,r:11},{x:1600,y:600,r:12},{x:1570,y:325,r:10},{x:1275,y:170,r:9},{x:620,y:185,r:9}];
const edges=[[0,1],[0,2],[0,3],[0,4],[0,5],[1,6],[1,7],[1,15],[2,13],[2,14],[3,8],[3,9],[4,10],[4,11],[4,12],[2,4],[1,3]];

function Opening(){
 const f=useCurrentFrame();
 const scene=f<120?0:f<240?1:f<330?2:f<480?3:f<570?4:5;
 const t=f-[0,120,240,330,480,570][scene];
 return <AbsoluteFill style={{background:C.paper,color:C.ink,fontFamily:'Satoshi',overflow:'hidden'}}>
 {scene===0&&<>
   <div style={{position:'absolute',inset:0,transform:`translateY(${-ease(t,94,26)*125}px) scale(${1-ease(t,94,26)*.035})`}}>
    <Reveal f={t} style={{textAlign:'center',position:'absolute',top:200,width:'100%'}}><H style={{fontSize:214,letterSpacing:-10}}>Three agents.</H></Reveal>
    <div style={{position:'absolute',top:565,left:275,right:275,display:'flex',justifyContent:'space-between'}}>{['Interface','Database','Payments'].map((name,i)=>{const p=ease(t,15+i*9,36);const colours=['#B9CDEE','#D1BEEB','#C2DDC9'];return <div key={name} style={{width:300,textAlign:'center',opacity:p,transform:`translateY(${(1-p)*140}px)`}}><div style={{width:117,height:117,borderRadius:'50%',margin:'0 auto',background:`radial-gradient(circle at 30% 25%, #FFFFFF 0%, ${colours[i]} 48%, ${colours[i]} 75%, #ffffff 120%)`,boxShadow:`0 24px 35px -20px ${colours[i]}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:33,color:'#39404B'}}> {'{ }'} </div><div style={{marginTop:39,fontSize:31,letterSpacing:-.5}}>{name}</div></div>})}</div>
   </div>
 </>}
 {scene===1&&<>
   <div style={{position:'absolute',left:0,right:0,top:195,textAlign:'center',transform:`scale(${mix(1.16,1,ease(t,0,48))})`,opacity:ease(t,0,15)}}><H style={{fontSize:370,fontWeight:800,letterSpacing:-20}}>47</H><div style={{fontSize:55,letterSpacing:-2,color:C.muted,marginTop:0}}>files changed.</div></div>
   {[0,1].map(row=><div key={row} style={{position:'absolute',top:805+row*80,left:-100,display:'flex',gap:90,whiteSpace:'nowrap',fontSize:25,color:row?'#ADB0B5':'#858991',opacity:ease(t,20+row*7),transform:`translateX(${(row?-1:1)*(t*.9-100)}px)`}}>{files.slice(row*5,row*5+6).map(s=><span key={s}>{s}</span>)}</div>)}
 </>}
 {scene===2&&<AbsoluteFill style={{alignItems:'center',justifyContent:'center'}}>
   <Reveal f={t}><H style={{textAlign:'center',fontSize:166}}>Do you know<br/>what <span style={{color:C.violet}}>changed?</span></H></Reveal>
 </AbsoluteFill>}
 {scene===3&&<>
   <div style={{position:'absolute',inset:0,transform:`translateY(${mix(260,0,ease(t,0,68))}px) scale(${mix(2.6,.8,ease(t,0,68))})`,transformOrigin:'960px 625px'}}>
   <svg width="1920" height="1080" style={{position:'absolute',inset:0}}>
    {edges.map(([a,b],i)=><line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} stroke={C.line} strokeWidth={2.5} pathLength={1} strokeDasharray={1} strokeDashoffset={1-ease(t,12+i*2,38)}/>)}
    {nodes.map((n,i)=>{const active=i<5;const p=ease(t,i*2,30);return <g key={i} opacity={p}>{active&&<circle cx={n.x} cy={n.y} r={n.r+14+Math.sin(t/17+i)*4} fill="#7759CF0D"/>}<circle cx={n.x} cy={n.y} r={n.r*p} fill={active?C.violet:'#C8C9CE'}/></g>})}
   </svg>
   {['Your project','Interface','Payments','Database','API'].map((name,i)=><div key={name} style={{position:'absolute',left:nodes[i].x-170,top:nodes[i].y+44,width:340,textAlign:'center',fontSize:29,color:i===0?C.ink:C.muted,opacity:ease(t,45)}}>{name}</div>)}
   </div>
   <Reveal f={t} at={34} style={{position:'absolute',top:110,width:'100%',textAlign:'center'}}><H style={{fontSize:114,letterSpacing:-4}}>Now it connects.</H></Reveal>
 </>}
 {scene===4&&<AbsoluteFill style={{justifyContent:'center',alignItems:'center'}}>
   <div style={{position:'absolute',left:450,top:390,width:1020,height:240,background:'radial-gradient(ellipse,#E3DCEF66,transparent 68%)',filter:'blur(45px)'}}/>
   <Reveal f={t}><H style={{fontSize:251,letterSpacing:-12}}>Brainstorm<span style={{color:C.violet}}>.</span></H></Reveal>
   <Reveal f={t} at={14} style={{fontSize:36,color:C.muted,marginTop:35}}>Keep your brain in the loop.</Reveal>
 </AbsoluteFill>}
 {scene===5&&<>
   <Reveal f={t} style={{position:'absolute',top:90,width:'100%',textAlign:'center'}}><H style={{fontSize:120,letterSpacing:-5}}>Every step. <span style={{color:C.violet}}>In context.</span></H></Reveal>
   <div style={{position:'absolute',left:330,top:325,width:1260,height:870,borderRadius:20,background:'#FFFFFF',boxShadow:'0 26px 90px #2223260D',border:'1px solid #E9E9EF',overflow:'hidden',transform:`translateY(${(1-ease(t,8,46))*600}px) scale(${1+ease(t,85,55)*.045})`,transformOrigin:'center 35%'}}>
     <div style={{height:77,padding:'24px 42px',display:'flex',alignItems:'center',gap:48,borderBottom:'1px solid #EFEFF2',fontSize:23}}><div style={{fontFamily:'Cabinet Grotesk',fontWeight:700,fontSize:32,marginRight:25}}>brainstorm.</div><span style={{color:C.violet}}>Follow</span><span style={{color:C.muted}}>Map</span></div>
     <div style={{padding:'44px 75px'}}><div style={{fontFamily:'Cabinet Grotesk',fontWeight:700,fontSize:47,letterSpacing:-1.5,marginBottom:37}}>Add payments</div>
      <div style={{position:'relative',paddingLeft:46}}><div style={{position:'absolute',left:8,top:14,bottom:45,width:2,background:'#E8E5EF'}}/>
       {['Read checkout flow','Added payment webhook','Updated validation'].map((s,i)=><div key={s} style={{position:'relative',padding:'5px 0 27px',opacity:ease(t,24+i*14)}}><div style={{position:'absolute',left:-45,top:13,width:16,height:16,borderRadius:20,background:i===1?C.violet:'#C9CBD0',boxShadow:'0 0 0 7px white'}}/><div style={{fontSize:28,color:i===1?C.violet:C.muted}}>{s}</div>{i===1&&<div style={{fontFamily:'monospace',fontSize:22,lineHeight:1.7,color:'#598068',margin:'15px 0 5px'}}>+ verifySignature(request)<br/>+ await processPayment(event)</div>}</div>)}
      </div>
      <div style={{fontSize:25,borderTop:'1px solid #E8E5EF',paddingTop:28,marginTop:12,color:C.muted,opacity:ease(t,94)}}>Why verify the signature?<span style={{float:'right',color:C.violet}}>↑</span></div>
     </div>
   </div>
 </>}
 </AbsoluteFill>;
}
registerRoot(()=> <Composition id="Opening" component={Opening} durationInFrames={720} fps={30} width={1920} height={1080}/>);
