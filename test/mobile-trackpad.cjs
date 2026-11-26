const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync(__dirname+'/../views/default-mobile.handlebars','utf8').split('\r').join('');
const start=html.indexOf('        var trackpadMode = false;'),end=html.indexOf('        // TERMINAL',start);
const code=html.slice(start,end);let passed=0;
function setup(){
 let timers=new Map(),next=0,events=[],listeners={},els={};
 const get=id=>els[id]??=( {style:{},scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:0,top:0,width:400,height:800})});
 const ctx={setTimeout:(f,t)=>{timers.set(++next,{f,t});return next},clearTimeout:i=>timers.delete(i),setInterval:()=>0,clearInterval:()=>{},window:{scrollX:0,scrollY:0,addEventListener:(n,f)=>listeners[n]=f},document:{hidden:false,addEventListener:(n,f)=>listeners[n]=f},Q:get,QV:()=>{},setSessionActivity:()=>{},xxdialogMode:0,features2:0,currentNode:{agent:{id:4}},GetNodeRights:()=>0xFFFFFFFF,fullscreen:false,desktop:{State:3,m:{mousedown:e=>events.push(['down',e.buttons]),mouseup:e=>events.push(['up',e.buttons]),mousemove:e=>events.push(['move',e.buttons])}}};
 ctx.addEventListener=ctx.window.addEventListener;ctx.scrollX=0;ctx.scrollY=0;ctx.window=ctx;
 ctx.dtouchstart=function(){};ctx.deskToggleTrackpad=function(){};ctx.connectDesktop=function(){};ctx.onDesktopStateChange=function(){};
 vm.createContext(ctx);vm.runInContext(code,ctx);ctx.trackpadMode=true;
 return {ctx,events,listeners,timers,tick:()=>{for(const [i,t]of [...timers].sort((a,b)=>a[1].t-b[1].t)){if(timers.has(i)){timers.delete(i);t.f()}}}};
}
const e=(x=10,y=10,n=1)=>({touches:Array.from({length:n},()=>({clientX:x,clientY:y})),preventDefault(){}});
function test(name,fn){fn();passed++;console.log('PASS '+name)}
test('hold, drag and release sends one down/move-held/up',()=>{let s=setup();s.ctx.dtouchstart(e());s.tick();s.ctx.dtouchmove(e(20));s.ctx.dtouchend(e());assert.deepEqual(s.events,[['down',1],['move',1],['up',0]])});
test('short tap remains one click',()=>{let s=setup();s.ctx.dtouchstart(e());s.ctx.dtouchend(e());s.tick();assert.deepEqual(s.events,[['down',1],['up',0]])});
test('ordinary movement does not grab objects',()=>{let s=setup();s.ctx.dtouchstart(e());s.ctx.dtouchmove(e(30));s.tick();s.ctx.dtouchend(e());assert.deepEqual(s.events,[['move',0]])});
for(const event of ['blur','touchcancel','touchend','visibilitychange'])test(event+' releases held button',()=>{let s=setup();s.ctx.dtouchstart(e());s.tick();s.ctx.document.hidden=true;s.listeners[event]();assert.deepEqual(s.events,[['down',1],['up',0]]);assert.equal(s.ctx.trackpadDown,false)});
test('mode switch releases drag and restores browser touch action',()=>{let s=setup();s.ctx.dtouchstart(e());s.tick();s.ctx.deskToggleTrackpad();assert.deepEqual(s.events,[['down',1],['up',0]]);assert.equal(s.ctx.Q('Desk').style.touchAction,'')});
test('multitouch cancels drag',()=>{let s=setup();s.ctx.dtouchstart(e());s.tick();s.ctx.dtouchmove(e(30,10,2));assert.deepEqual(s.events,[['down',1],['up',0]])});
test('view-only rights cannot begin drag',()=>{let s=setup();s.ctx.GetNodeRights=()=>8|256;s.ctx.dtouchstart(e());s.tick();assert.deepEqual(s.events,[])});
test('disconnected session cannot begin drag',()=>{let s=setup();s.ctx.dtouchstart(e());s.ctx.desktop.State=0;s.tick();assert.deepEqual(s.events,[])});
test('cancelled press cannot trigger delayed drag',()=>{let s=setup();s.ctx.dtouchstart(e());s.ctx.trackpadCancelGesture();s.tick();assert.deepEqual(s.events,[])});
assert(html.includes('function connectDesktop(e, contype, tsid, consent) {\n            trackpadCancelGesture();'));
test('two-finger tap sends exactly one right click',()=>{let s=setup();s.ctx.dtouchstart(e(10,10,2));s.ctx.dtouchend(e(10,10,1));assert.deepEqual(s.events,[]);s.ctx.dtouchend(e(10,10,0));s.ctx.dtouchend(e(10,10,0));assert.deepEqual(s.events,[['down',2],['up',0]])});
test('two-finger movement does not click',()=>{let s=setup();s.ctx.dtouchstart(e(10,10,2));s.ctx.dtouchmove(e(30,10,2));s.ctx.dtouchend(e(30,10,0));assert.deepEqual(s.events,[])});
test('long two-finger hold does not click',()=>{let s=setup();s.ctx.dtouchstart(e(10,10,2));s.tick();s.ctx.dtouchend(e(10,10,0));assert.deepEqual(s.events,[])});
test('second finger during drag releases without right click',()=>{let s=setup();s.ctx.dtouchstart(e());s.tick();s.ctx.dtouchstart(e(10,10,2));s.ctx.dtouchend(e(10,10,0));assert.deepEqual(s.events,[['down',1],['up',0]])});
test('view-only denies two-finger click',()=>{let s=setup();s.ctx.GetNodeRights=()=>8|256;s.ctx.dtouchstart(e(10,10,2));s.ctx.dtouchend(e(10,10,0));assert.deepEqual(s.events,[])});
function wheelSetup(){const s=setup();s.ctx.desktop.m.mousewheel=e=>s.events.push(['wheel',e.wheelDelta,e.buttons]);return s;}
test('two-finger upward swipe scrolls down with no click',()=>{let s=wheelSetup();s.ctx.dtouchstart(e(10,100,2));s.ctx.dtouchmove(e(10,70,2));s.ctx.dtouchend(e(10,70,0));assert.deepEqual(s.events,[['wheel',-120,0]])});
test('two-finger downward swipe scrolls up',()=>{let s=wheelSetup();s.ctx.dtouchstart(e(10,100,2));s.ctx.dtouchmove(e(10,130,2));s.ctx.dtouchend(e(10,130,0));assert.deepEqual(s.events,[['wheel',120,0]])});
test('small movement accumulates into wheel steps',()=>{let s=wheelSetup();s.ctx.dtouchstart(e(10,100,2));s.ctx.dtouchmove(e(10,90,2));s.ctx.dtouchmove(e(10,80,2));s.ctx.dtouchmove(e(10,70,2));assert.deepEqual(s.events,[['wheel',-120,0]])});
test('lifting one finger stops scrolling',()=>{let s=wheelSetup();s.ctx.dtouchstart(e(10,100,2));s.ctx.dtouchend(e(10,100,1));s.ctx.dtouchmove(e(10,30,1));s.ctx.dtouchend(e(10,30,0));assert.deepEqual(s.events,[])});
test('view-only denies wheel events',()=>{let s=wheelSetup();s.ctx.GetNodeRights=()=>8|256;s.ctx.dtouchstart(e(10,100,2));s.ctx.dtouchmove(e(10,20,2));assert.deepEqual(s.events,[])});
test('adding finger during drag does not scroll',()=>{let s=wheelSetup();s.ctx.dtouchstart(e());s.tick();s.ctx.dtouchstart(e(10,100,2));s.ctx.dtouchmove(e(10,20,2));s.ctx.dtouchend(e(10,20,0));assert.deepEqual(s.events,[['down',1],['up',0]])});
console.log(passed+' tests passed');
