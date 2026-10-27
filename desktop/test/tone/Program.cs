using System.Runtime.InteropServices;
using System.Text;
internal static class Program {
    [DllImport("winmm.dll", SetLastError=true, EntryPoint="PlaySoundW")]
    private static extern bool PlaySound(IntPtr data, IntPtr module, uint flags);
    private static int Main(string[] args) {
        if(args.Length!=1 || !int.TryParse(args[0],out var frequency) || frequency<220 || frequency>1760)return 2;
        const int rate=48000,frames=4800;using var file=new MemoryStream();using var w=new BinaryWriter(file,Encoding.ASCII,true);
        w.Write(Encoding.ASCII.GetBytes("RIFF"));w.Write(36+frames*2);w.Write(Encoding.ASCII.GetBytes("WAVEfmt "));w.Write(16);w.Write((short)1);w.Write((short)1);w.Write(rate);w.Write(rate*2);w.Write((short)2);w.Write((short)16);w.Write(Encoding.ASCII.GetBytes("data"));w.Write(frames*2);
        for(var i=0;i<frames;i++)w.Write((short)(0.06*short.MaxValue*Math.Sin(2*Math.PI*frequency*i/rate)));
        var bytes=file.ToArray();var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
        try { if(!PlaySound(pin.AddrOfPinnedObject(),IntPtr.Zero,0x0001|0x0004|0x0008))return 3;Console.WriteLine("ready");Thread.Sleep(20000); }
        finally { PlaySound(IntPtr.Zero,IntPtr.Zero,0);pin.Free(); }
        return 0;
    }
}
