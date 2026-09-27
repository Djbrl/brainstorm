import React from 'react';
import {AbsoluteFill, Composition, Easing, interpolate, registerRoot, spring, useCurrentFrame} from 'remotion';

const C={paper:'#F4F2ED',ink:'#20211F',muted:'#777A72',violet:'#7354DF',lime:'#D7F78F',line:'#DADBD3'};
const font='Helvetica Neue, Arial, sans-serif';
const clamp=(v:number)=>Math.min(1,Math.max(0,v));
const ease=(f:number,start:number,d=24)=>interpolate(f,[start,start+d],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.22,1,.36,1)});
const Label:React.FC<{children:React.ReactNode,dark?:boolean}>=({children,dark})=><div style={{position:'absolute',left:94,top:66,fontSize:23,letterSpacing:3,fontWeight:500,color:dark?'#BFC0B7':C.muted}}>{children}</div>;
const Big:React.FC<{children:React.ReactNode,style?:React.CSSProperties}>=({children,style})=><div style={{fontSize:150,fontWeight:650,lineHeight:1.02,letterSpacing:-9,...style}}>{children}</div>;
const Reveal:React.FC<{f:number,at?:number,children:React.ReactNode,style?:React.CSSProperties}>=({f,at=0,children,style})=>{const p=ease(f,at);return <div style={{opacity:p,transform:`translateY(${(1-p)*65}px)`,...style}}>{children}</div>};
const files=['auth/session.ts','payments/webhook.ts','web/Dashboard.tsx','api/router.ts','data/schema.ts','tests/auth.test.ts','lib/checkout.ts','web/Settings.tsx','server/index.ts','hooks/useSession.ts','styles/theme.css','lib/validate.ts'];
const nodes=Array.from({length:18},(_,i)=>({x:260+(i%6)*278+(Math.floor(i/6)%2)*28,y:370+Math.floor(i/6)*205,name:files[i%files.length]}));
function Opening(){
 const f=useCurrentFrame();
 const scene=f<120?0:f<240?1:f<330?2:f<480?3:f<570?4:5;
 const local=f-[0,120,240,330,480,570][scene];
 return <AbsoluteFill style={{background:scene===2?C.ink:scene===4?C.violet:C.paper,color:C.ink,fontFamily:font,overflow:'hidden'}}>
  {scene===0&&<>
   <Label>THE WAY WE BUILD HAS CHANGED.</Label>
   <Reveal f={local} style={{position:'absolute',left:110,top:230}}><Big>Three agents.</Big></Reveal>
   <div style={{position:'absolute',left:110,right:110,top:525,display:'flex',gap:30}}>{['Build the interface.','Connect the database.','Add payments.'].map((s,i)=>{const p=spring({fps:30,frame:local-16-i*9,config:{damping:19,stiffness:105}});return <div key={s} style={{flex:1,background:i===1?C.violet:'#FFFFFF',color:i===1?'white':C.ink,borderRadius:26,padding:'36px 34px 40px',boxShadow:'0 18px 55px #20211F0B',transform:`translateY(${(1-p)*230}px) rotate(${(1-p)*(i-1)*8}deg)`,opacity:clamp(p)}}><div style={{fontSize:19,letterSpacing:2,opacity:.65}}>AGENT 0{i+1}</div><div style={{fontSize:35,marginTop:36,letterSpacing:-1}}>{s}</div><div style={{marginTop:42,fontSize:22,opacity:.8}}><span style={{display:'inline-block',height:10,width:10,borderRadius:10,background:i===1?C.lime:C.violet,marginRight:10}}/> Working</div></div>})}</div>
  </>}
  {scene===1&&<>
   {Array.from({length:30},(_,i)=>{const p=ease(local,Math.floor(i/5)*5,20);const x=(i%6)*355-140;const y=Math.floor(i/6)*195-20;return <div key={i} style={{position:'absolute',left:x,top:y,width:320,height:152,padding:22,boxSizing:'border-box',borderRadius:15,background:'#FFFFFF',border:'1px solid #E6E7E0',opacity:p*.8,transform:`translateY(${(1-p)*190}px) rotate(${(i%3-1)*5}deg)`}}><div style={{fontSize:19,color:C.muted}}>{files[i%files.length]}</div><div style={{height:7,width:'72%',background:'#E1EBCF',marginTop:20}}/><div style={{height:7,width:'50%',background:'#E1EBCF',marginTop:10}}/><div style={{height:7,width:'61%',background:'#EFDFDC',marginTop:10}}/></div>})}
   <AbsoluteFill style={{background:'radial-gradient(ellipse at center, #F4F2ED 23%, #F4F2EDD9 43%, #F4F2ED00 75%)',justifyContent:'center',alignItems:'center'}}><Reveal f={local} at={10}><Big style={{fontSize:184,textAlign:'center'}}>47 files<br/><span style={{color:C.violet}}>changed.</span></Big></Reveal></AbsoluteFill>
  </>}
  {scene===2&&<>
    <Label dark>ONE QUESTION.</Label><AbsoluteFill style={{justifyContent:'center',padding:110}}><Reveal f={local}><Big style={{color:C.paper,fontSize:158}}>Do you know<br/>what changed<span style={{color:C.lime}}>?</span></Big></Reveal></AbsoluteFill>
  </>}
  {scene===3&&<>
    <Label>FROM CHANGES TO UNDERSTANDING.</Label>
    <Reveal f={local}><Big style={{position:'absolute',left:100,top:140,fontSize:94,letterSpacing:-5}}>See how it all connects.</Big></Reveal>
    <svg width="1920" height="1080" style={{position:'absolute',inset:0}}>{nodes.slice(1).map((n,i)=>{const prev=nodes[Math.max(0,i-(i%3===0?3:0))];return <line key={i} x1={prev.x} y1={prev.y} x2={n.x} y2={n.y} stroke={C.line} strokeWidth={3} opacity={ease(local,18+i*2)}/>})}{[0,2,4,6,8,10].map(i=><line key={'v'+i} x1={nodes[i].x} y1={nodes[i].y} x2={nodes[i+6].x} y2={nodes[i+6].y} stroke={C.line} strokeWidth={3} opacity={ease(local,30+i)}/>)}</svg>
    {nodes.map((n,i)=>{const p=ease(local,i*2,35);const active=[3,7,14].includes(i);return <div key={i} style={{position:'absolute',left:n.x-72,top:n.y-38,width:144,textAlign:'center',transform:`translate(${(1-p)*((i%3-1)*450)}px,${(1-p)*280}px) scale(${.7+.3*p})`,opacity:p}}><div style={{height:76,width:76,margin:'0 auto',borderRadius:25,background:active?C.violet:'#FFFFFF',boxShadow:active?`0 0 0 ${12+5*Math.sin(local/13+i)}px #7354DF14, 0 15px 40px #7354DF25`:'0 8px 20px #20211F08',display:'flex',alignItems:'center',justifyContent:'center',fontSize:27,color:active?'white':C.muted}}> {'{ }'} </div><div style={{fontSize:18,marginTop:17,color:active?C.ink:C.muted,whiteSpace:'nowrap',position:'relative',left:-30,width:204}}>{n.name}</div></div>})}
    <div style={{position:'absolute',bottom:81,right:105,fontSize:22,color:C.muted,opacity:ease(local,65)}}><span style={{display:'inline-block',height:10,width:10,borderRadius:8,background:C.violet,marginRight:10}}/> Where your agents are working.</div>
  </>}
  {scene===4&&<AbsoluteFill style={{justifyContent:'center',alignItems:'center',color:'#FFFFFF'}}>
    <Reveal f={local}><Big style={{fontSize:226,letterSpacing:-13}}>Brainstorm<span style={{color:C.lime}}>.</span></Big></Reveal>
    <Reveal f={local} at={16} style={{marginTop:44,fontSize:39,letterSpacing:-1}}>Your code. Your agents. Your understanding.</Reveal>
  </AbsoluteFill>}
  {scene===5&&<>
   <Label>01 / FOLLOW</Label>
   <Reveal f={local} style={{position:'absolute',left:105,top:340,width:570}}><Big style={{fontSize:104,letterSpacing:-6}}>Every step.<br/><span style={{color:C.violet}}>In context.</span></Big><div style={{fontSize:29,lineHeight:1.5,color:C.muted,marginTop:35,width:475}}>Follow the work.<br/>Understand the change.</div></Reveal>
   <div style={{position:'absolute',left:730,top:140,width:1240,height:830,borderRadius:30,background:'white',boxShadow:'0 35px 100px #20211F12',overflow:'hidden',transform:`translateX(${(1-ease(local,0,38))*700}px) scale(${1+.025*ease(local,65,65)})`,transformOrigin:'60% 50%'}}>
    <div style={{padding:'28px 38px',background:'#FAFAF7',borderBottom:'1px solid #EBECE5',fontSize:24,display:'flex',gap:44}}><b>brainstorm.</b><span style={{color:C.violet}}>Follow</span><span style={{color:C.muted}}>Map</span><span style={{color:C.muted}}>History</span></div>
    <div style={{padding:'40px 50px'}}><div style={{fontSize:19,letterSpacing:2,color:C.muted}}>PAYMENTS / AGENT 03</div><div style={{fontSize:43,letterSpacing:-1.5,margin:'19px 0 33px'}}>Add payments</div>
     {['Read the checkout flow','Added payment webhook','Updated checkout validation'].map((s,i)=><div key={s} style={{padding:'22px 25px',marginBottom:14,borderRadius:15,background:i===1?'#F0ECFC':'#FAFAF7',opacity:ease(local,14+i*15),transform:`translateY(${(1-ease(local,14+i*15))*35}px)`}}><div style={{fontSize:27,color:i===1?C.violet:C.ink}}>{s}<span style={{float:'right',fontSize:20,color:C.muted}}>Edit</span></div>{i===1&&<div style={{fontFamily:'monospace',fontSize:19,lineHeight:1.8,marginTop:18,color:'#4A6050'}}>+ verifySignature(request)<br/>+ await processPayment(event)</div>}</div>)}
     <div style={{marginTop:24,borderRadius:16,padding:'24px',border:'1px solid #D7D0EA',fontSize:25,color:C.muted,opacity:ease(local,82)}}>Why verify the signature here?<span style={{float:'right',color:C.violet}}>↑</span></div>
    </div>
   </div>
  </>}
  <div style={{position:'absolute',bottom:23,left:35,fontSize:15,letterSpacing:1.4,color:scene===2||scene===4?'#FFFFFF85':'#777A72',opacity:.8}}>DIRECTION 01 · CONCEPT ANIMATION · ILLUSTRATIVE DATA</div>
 </AbsoluteFill>
}
registerRoot(()=> <Composition id="Opening" component={Opening} durationInFrames={720} fps={30} width={1920} height={1080}/>);
