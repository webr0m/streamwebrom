// Bounded PCM bridge. No microphone/room mix is added to this graph.
class NativeAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.capacity=4800; this.left=new Float32Array(this.capacity);this.right=new Float32Array(this.capacity);this.read=0;this.write=0;this.rate=48000;
    this.port.onmessage=({data})=>{
      if(!(data.samples instanceof Float32Array)||data.channels!==2||!Number.isFinite(data.rate)||data.rate<8000||data.rate>192000)return;
      this.rate=data.rate;const frames=Math.floor(data.samples.length/2),start=Math.max(0,frames-this.capacity);
      for(let i=start;i<frames;i++){
        const n=this.write++%this.capacity,l=data.samples[i*2],r=data.samples[i*2+1];
        this.left[n]=Number.isFinite(l)?Math.max(-1,Math.min(1,l)):0;
        this.right[n]=Number.isFinite(r)?Math.max(-1,Math.min(1,r)):0;
      }
      this.read=Math.max(this.read,this.write-this.capacity);
    };
  }
  process(_inputs,outputs) {
    const out=outputs[0];if(!out?.length)return true;
    const step=this.rate/sampleRate;
    for(let i=0;i<out[0].length;i++){
      if(this.read+1>=this.write){for(const c of out)c[i]=0;continue}
      const base=Math.floor(this.read),fraction=this.read-base,a=base%this.capacity,b=(base+1)%this.capacity;
      for(let c=0;c<out.length;c++){const src=c===0?this.left:this.right;out[c][i]=src[a]+(src[b]-src[a])*fraction}
      this.read+=step;
    }
    return true;
  }
}
registerProcessor('swr-native-audio',NativeAudioProcessor);
