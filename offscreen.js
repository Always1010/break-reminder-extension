let ctx;
chrome.runtime.onMessage.addListener(async msg => {
  if (msg.type !== "ring") return;
  ctx ||= new AudioContext();
  const gain = ctx.createGain(); gain.gain.value = msg.volume ?? .8; gain.connect(ctx.destination);
  if (msg.customSound) { const data = await (await fetch(msg.customSound)).arrayBuffer(); const buf = await ctx.decodeAudioData(data); const src = ctx.createBufferSource(); src.buffer = buf; src.connect(gain); src.start(); return; }
  const start = ctx.currentTime;
  const soft = msg.sound === "soft";
  (soft ? [0, .35] : [0, .22, .44, .66, .88]).forEach((offset, i) => { const osc = ctx.createOscillator(); osc.type = soft ? "sine" : "square"; osc.frequency.value = soft ? 520 : (i % 2 ? 660 : 880); osc.connect(gain); osc.start(start + offset); osc.stop(start + offset + (soft ? .28 : .16)); });
});
