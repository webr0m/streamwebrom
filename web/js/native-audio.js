// Native code remains in the desktop main process. The page receives only the
// PCM of a source explicitly selected in the trusted local picker.
export async function attachNativeAudio(stream) {
  const bridge=window.StreamWebRomCapture,selection=await bridge.take();
  let ctx,node,destination,unsubscribe,unsubscribeError,stopped=false,timer;
  const stop=()=>{
    if(stopped)return;stopped=true;clearInterval(timer);unsubscribe?.();unsubscribeError?.();
    bridge.stop(selection.id).catch(()=>{});node?.disconnect();destination?.stream.getTracks().forEach(t=>t.stop());ctx?.close().catch(()=>{});
  };
  try {
    unsubscribeError=bridge.onError(packet=>{
      if(packet.id!==selection.id||stopped)return;
      stream.dispatchEvent(new CustomEvent('captureerror',{detail:packet.message}));
      stop();stream.getTracks().forEach(t=>t.stop());
    });
    if(selection.mode==='native'){
      ctx=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
      await ctx.audioWorklet.addModule(new URL('./native-audio-worklet.js',import.meta.url));
      node=new AudioWorkletNode(ctx,'swr-native-audio',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
      destination=ctx.createMediaStreamDestination();node.connect(destination);
      unsubscribe=bridge.onAudio(packet=>{
        if(stopped||packet.id!==selection.id||!(packet.pcm instanceof ArrayBuffer))return;
        node.port.postMessage({samples:new Float32Array(packet.pcm),rate:packet.rate,channels:packet.channels},[packet.pcm]);
      });
      await ctx.resume();await bridge.start(selection.id);
      for(const old of stream.getAudioTracks()){stream.removeTrack(old);old.stop()}
      stream.addTrack(destination.stream.getAudioTracks()[0]);
    }
    const video=stream.getVideoTracks()[0];video?.addEventListener('ended',stop,{once:true});
    // stop() on a track deliberately does not fire "ended" in the browser API.
    timer=setInterval(()=>{if(video?.readyState==='ended')stop()},500);
    window.addEventListener('pagehide',stop,{once:true});
    const cleanup=()=>{window.removeEventListener('pagehide',stop);video?.removeEventListener('ended',stop);stop()};
    return {selection,cleanup};
  }catch(e){stop();stream.getTracks().forEach(t=>t.stop());throw e}
}
