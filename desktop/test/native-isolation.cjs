// Explicit physical-Windows audit. Only frequency/energy scores are persisted;
// system PCM stays in bounded memory and is discarded after each measurement.
const {fork,spawn}=require('node:child_process');const path=require('node:path');const assert=require('node:assert/strict');
const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const binding=option('binding'),tone=option('tone');
function db(samples,f){let a=0,b=0;const c=2*Math.cos(2*Math.PI*f/48000),n=samples.length;for(let i=0;i<n;i++){const q=samples[i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)))+c*a-b;b=a;a=q}return 20*Math.log10(Math.max(1e-12,4*Math.sqrt(Math.max(0,a*a+b*b-c*a*b))/n))}
if(option('role')==='tone-root'){
  const child=spawn(tone,['440'],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',()=>process.send?.({ready:true}));
  process.on('disconnect',()=>{child.kill();process.exit(0)});setTimeout(()=>{child.kill();process.exit(0)},21000).unref();
}else if(option('role')==='sample'){
  const native=require(path.resolve(binding));const samples=new Float32Array(48000);let count=0;const start=Date.now();
  native.startCapture(Number(option('pid')),option('include')==='true',(buffer,meta)=>{
    if(Date.now()-start<400)return;
    assert.equal(meta.sampleRate,48000);assert.equal(meta.channels,2);assert.equal(meta.bitsPerSample,32);assert.equal(meta.isFloat,true);
    for(let i=0;i<buffer.length&&count<samples.length;i+=8)samples[count++]=buffer.readFloatLE(i);
    if(count===samples.length){native.stopCapture();process.send?.({voiceDB:db(samples,440),contentDB:db(samples,880),frames:count},()=>process.exit(0))}
  });
}else{
  (async()=>{
    assert.equal(process.platform,'win32');assert.ok(binding&&tone,'Pass --binding=...node and --tone=...exe');
    const voice=fork(__filename,['--role=tone-root','--tone='+tone],{windowsHide:true,silent:true});
    const content=spawn(tone,['880'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    try{
      await Promise.all([new Promise((r,j)=>{voice.once('message',r);voice.once('exit',()=>j(new Error('voice tone failed')))}),new Promise((r,j)=>{content.stdout.once('data',r);content.once('exit',()=>j(new Error('content tone failed')))})]);
      const results=[];
      for(const [label,pid,include,wanted,unwanted] of [['include-call-tree',voice.pid,true,'voiceDB','contentDB'],['exclude-call-tree',voice.pid,false,'contentDB','voiceDB'],['include-content-app',content.pid,true,'contentDB','voiceDB']]){
        const result=await new Promise((resolve,reject)=>{
          const child=fork(__filename,['--role=sample','--binding='+binding,'--pid='+pid,'--include='+include],{windowsHide:true,silent:true});let done=false;
          const timer=setTimeout(()=>{child.kill();reject(new Error('Native measurement timed out: '+label))},10000);
          child.once('message',value=>{done=true;clearTimeout(timer);resolve(value)});
          child.once('exit',code=>{clearTimeout(timer);if(!done)reject(new Error('Measurement failed: '+label+' ('+code+')'))});
          child.stderr.on('data',data=>process.stderr.write(data));
        });
        assert.ok(result[wanted]>-70,label+': wanted tone was not captured '+JSON.stringify(result));
        assert.ok(result[wanted]-result[unwanted]>24,label+': excluded tone leaked '+JSON.stringify(result));
        results.push({label,...result,separationDB:result[wanted]-result[unwanted]});
      }
      console.log(JSON.stringify({physicalWindows:true,processTreeExclusionVerified:true,noRawAudioSaved:true,sampleRate:48000,results}));
    }finally{voice.kill();content.kill()}
  })().catch(e=>{console.error(e);process.exitCode=1});
}
