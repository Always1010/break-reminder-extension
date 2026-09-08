let context;

async function playReminder(message) {
  context ||= new AudioContext();
  if (context.state === "suspended") await context.resume();

  const gain = context.createGain();
  gain.gain.value = message.volume ?? 0.8;
  gain.connect(context.destination);

  if (message.customSound) {
    const data = await (await fetch(message.customSound)).arrayBuffer();
    const buffer = await context.decodeAudioData(data);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start();
    return;
  }

  const startsAt = context.currentTime;
  const soft = message.sound === "soft";
  const offsets = soft
    ? [0, 0.45, 1.4, 1.85, 2.8, 3.25]
    : Array.from({ length: 24 }, (_, index) => index * 0.24);

  offsets.forEach((offset, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = soft ? "sine" : "square";
    oscillator.frequency.value = soft ? 520 : (index % 2 ? 660 : 880);
    oscillator.connect(gain);
    oscillator.start(startsAt + offset);
    oscillator.stop(startsAt + offset + (soft ? 0.3 : 0.17));
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen" || message.type !== "ring") return false;
  playReminder(message)
    .then(() => sendResponse({ ok: true }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
