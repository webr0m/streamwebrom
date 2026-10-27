const {spawn}=require('node:child_process');const path=require('node:path');
const tone=process.argv.find(a=>a.startsWith('--tone='))?.slice(7);if(!tone)throw new Error('Pass --tone=...exe');
const content=spawn(tone,['880'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
content.stdout.once('data',()=>{
  const test=spawn(require('electron'),[path.join(__dirname,'electron-audio-proof.cjs')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  test.stdout.on('data',d=>process.stdout.write(d));test.stderr.on('data',d=>process.stderr.write(d));
  const timer=setTimeout(()=>test.kill(),22000);
  test.once('exit',code=>{clearTimeout(timer);content.kill();process.exitCode=code===0?0:1});
});
content.once('error',e=>{console.error(e);process.exitCode=1});
