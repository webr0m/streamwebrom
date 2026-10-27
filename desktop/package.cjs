const path=require('node:path');
const fs=require('node:fs');
(async()=>{
  const {packager}=await import('@electron/packager');
  const runtime=path.join(__dirname,'vendor/native-audio/build/Release/electron_native_screenshare.node');
  if(!fs.existsSync(runtime))throw new Error('Build native audio before packaging');
  const keep=new Set(['/vendor/native-audio/build','/vendor/native-audio/build/Release','/vendor/native-audio/build/Release/electron_native_screenshare.node']);
  const paths=await packager({dir:__dirname,name:'StreamWebRom-Capture',platform:'win32',arch:'x64',out:path.join(__dirname,'out'),overwrite:true,asar:false,prune:true,
    ignore:filename=>/^\/(out|test|\.git)(\/|$)/.test(filename)||(filename.startsWith('/vendor/native-audio/build')&&!keep.has(filename))});
  for(const folder of paths){
    fs.copyFileSync(path.join(__dirname,'vendor/native-audio/LICENSE'),path.join(folder,'LICENSE-native-audio.txt'));
    fs.copyFileSync(path.join(__dirname,'vendor/native-audio/ORIGIN.md'),path.join(folder,'NATIVE-AUDIO-ORIGIN.md'));
    fs.copyFileSync(path.join(__dirname,'../LICENSE'),path.join(folder,'LICENSE-StreamWebRom.txt'));
  }
  console.log(paths.join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1});
