"""Exercise real local segmentation and compare responsiveness with a baseline."""
import argparse
import json
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://localhost:18443')
parser.add_argument('--baseline')
parser.add_argument('--browser')
args=parser.parse_args()
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=['--autoplay-policy=no-user-gesture-required'])
    for url in ([args.baseline] if args.baseline else [])+[args.url]:
        context=browser.new_context(service_workers='block')
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script("""window.__workers=0;const W=Worker;
          window.Worker=class extends W{constructor(...args){super(...args);window.__workers++;this.__ended=false}
            terminate(){if(!this.__ended){window.__workers--;this.__ended=true}return super.terminate()}};
        """)
        page.goto(url+'/diagnostics')
        result=page.evaluate("""async()=>{
          const {applyEffect}=await import('/js/effects.js');
          const input=document.createElement('canvas');input.width=1280;input.height=720;
          const ctx=input.getContext('2d');let index=0;
          const paint=()=>{ctx.fillStyle=`hsl(${index++%360} 70% 50%)`;ctx.fillRect(0,0,input.width,input.height)};
          paint();const timer=setInterval(paint,1000/30),raw=input.captureStream(30).getVideoTracks()[0];
          const start=performance.now();const output=await applyEffect(raw,{effect:'blur',quality:'720',fps:'30',effectPerformance:'fast'});
          const initMs=performance.now()-start;
          if(output===raw)throw Error('segmentation failed: plain-camera fallback is not a passing test');
          const video=document.createElement('video');video.muted=true;video.srcObject=new MediaStream([output]);document.body.append(video);await video.play();
          if(output.effectMetrics){const deadline=performance.now()+10000;while(output.effectMetrics.worker.completed<3&&performance.now()<deadline)await new Promise(r=>setTimeout(r,50));}
          const lags=[];let last=performance.now(),frames=0,ended=false;
          const count=()=>{if(ended)return;frames++;video.requestVideoFrameCallback(count)};
          video.requestVideoFrameCallback(count);
          const loop=setInterval(()=>{const now=performance.now();lags.push(Math.max(0,now-last-10));last=now},10);
          await new Promise(r=>setTimeout(r,3500));clearInterval(loop);ended=true;lags.sort((a,b)=>a-b);
          const metrics=output.effectMetrics?JSON.parse(JSON.stringify(output.effectMetrics)):null;
          output.stop();clearInterval(timer);video.pause();video.srcObject=null;video.remove();
          return {initMs:Math.round(initMs),decodedFrames:frames,eventLoopP95Ms:Math.round(lags[Math.floor(lags.length*.95)]||0),eventLoopMaxMs:Math.round(lags.at(-1)||0),metrics,rawEnded:raw.readyState==='ended',workersAfterStop:__workers};
        }""")
        assert not errors,errors
        assert result['decodedFrames']>=1,result
        assert result['rawEnded'],result
        if url==args.url:
            assert result['decodedFrames']>=25,result
            assert result['metrics'] and result['metrics']['worker']['completed']>=3,result
            assert not result['metrics']['worker']['failed'],result
            assert result['metrics']['maxInFlight']==1 and result['workersAfterStop']==0,result
        result['url']=url;results.append(result)
        context.close()
    browser.close()
print(json.dumps(results),flush=True)
