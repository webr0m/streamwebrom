export async function captureFile(file) {
  const url = URL.createObjectURL(file);
  let video, timer;
  const cleanup = () => {
    clearInterval(timer);
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    URL.revokeObjectURL(url);
  };
  try {
    let stream;
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      stream = canvas.captureStream(2);
      const draw = () => ctx.drawImage(img, 0, 0);
      draw();
      timer = setInterval(draw, 500);
    } else {
      video = document.createElement("video");
      video.loop = video.playsInline = true;
      video.src = url;
      await video.play();
      const capture = video.captureStream || video.mozCaptureStream;
      if (!capture) throw new Error("captureStream unavailable");
      stream = capture.call(video);
      // Play the file to the program mixer, never a second time locally.
      video.muted = true;
    }
    return { stream, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
