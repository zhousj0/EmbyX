const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
for(const lang of ['zh','en']){
 const events={},winEvents={},docEvents={},timers=[];let hidden=0,next=0;
 const video={currentTime:40,duration:200,playbackRate:1},progress={style:{}},toast={classList:{add(){},remove(){}}};
 const otherVideo={playbackRate:0.75};
 const container={style:{},addEventListener:(n,f)=>events[n]=f};
 const document={documentElement:{lang},hidden:false,getElementById:id=>id==='stageSpeedToast'?toast:id==='progressLine'?progress:id==='video-p0'?video:id==='video-p1'?otherVideo:null,addEventListener:(n,f)=>docEvents[n]=f};
 const window={innerWidth:400,addEventListener:(n,f)=>{const old=winEvents[n];winEvents[n]=(...args)=>{old?.(...args);f(...args)}}};
 const ctx={window,document,setTimeout:f=>{timers.push(f);return timers.length},clearTimeout(){},console};vm.createContext(ctx);vm.runInContext(fs.readFileSync(lang+'/js/stage.js','utf8'),ctx);
 const stage=Object.create(window.StageEngine.prototype);stage.app={state:{viewMode:'stream',currentIndex:0},input:{showProgressOSD(){},hideProgressOSD(){hidden++}},nextVideo(){next++},prevVideo(){}};stage.bindGestures(container);
 const ev=(x,y)=>({target:{closest:()=>null},touches:[{clientX:x,clientY:y}],changedTouches:[{clientX:x,clientY:y}],cancelable:true,preventDefault(){}});
 events.touchstart(ev(0,100));events.touchmove(ev(1,70));events.touchmove(ev(100,40));assert.notEqual(stage.app.state.isDragging,true);events.touchend(ev(100,40));assert.equal(next,1);assert.equal(video.currentTime,40);
 events.touchstart(ev(0,100));events.touchmove(ev(30,99));assert.equal(stage.app.state.isDragging,true);events.touchcancel();assert.equal(stage.app.state.isDragging,false);assert.equal(progress.style.transition,'');assert.equal(video.currentTime,40);assert.ok(hidden);
 events.touchstart(ev(0,100));events.touchmove(ev(30,99));winEvents.blur();assert.equal(stage.app.state.isDragging,false);
 video.playbackRate=1.5;winEvents.blur();assert.equal(video.playbackRate,1.5);
 events.touchstart(ev(0,100));timers.at(-1)();assert.equal(video.playbackRate,2);
 events.touchend(ev(0,100));assert.equal(video.playbackRate,1.5);
 events.touchstart(ev(0,100));timers.at(-1)();stage.app.state.currentIndex=1;
 winEvents.blur();assert.equal(video.playbackRate,1.5);assert.equal(otherVideo.playbackRate,0.75);
 console.log(lang+': direction lock, cancellation and original playback speed restoration passed');
}


