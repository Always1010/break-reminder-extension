const SOUND_FILES = {
  "digital-alarm": "sounds/digital-alarm.wav",
  "siren-alarm": "sounds/siren-alarm.wav",
  "gentle-rain": "sounds/gentle-rain.ogg",
  "gentle-wind": "sounds/gentle-wind.ogg",
  "piano-loop": "sounds/piano-loop.mp3",
  "calm-loop": "sounds/calm-loop.mp3",
  "soft-sax": "sounds/soft-sax.ogg"
};

let context;
let loopTimer;
let stopTimer;
const activeNodes = new Set();

function stopPlayback() {
  clearInterval(loopTimer);
  clearTimeout(stopTimer);
  loopTimer = undefined;
  stopTimer = undefined;
  for (const node of activeNodes) {
    try { node.stop(); } catch { /* node already ended */ }
    try { node.disconnect(); } catch { /* node already disconnected */ }
  }
  activeNodes.clear();
}

function trackNode(node) {
  activeNodes.add(node);
  node.addEventListener("ended", () => activeNodes.delete(node), { once: true });
}

function playSynthPattern(message, gain) {
  const startsAt = context.currentTime + 0.03;
  const soft = message.sound === "soft";
  const offsets = soft ? [0, 0.45] : [0, 0.24, 0.48, 0.72];

  offsets.forEach((offset, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = soft ? "sine" : "square";
    oscillator.frequency.value = soft ? 520 : (index % 2 ? 660 : 880);
    oscillator.connect(gain);
    trackNode(oscillator);
    oscillator.start(startsAt + offset);
    oscillator.stop(startsAt + offset + (soft ? 0.3 : 0.17));
  });
}

async function loadAudioBuffer(message) {
  if (message.sound === "white-noise") {
    const frameCount = context.sampleRate * 4;
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }
  const sourceUrl = message.sound === "custom"
    ? message.customSound
    : SOUND_FILES[message.sound] && chrome.runtime.getURL(SOUND_FILES[message.sound]);
  if (!sourceUrl) return null;
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`无法加载铃声（${response.status}）`);
  return context.decodeAudioData(await response.arrayBuffer());
}

async function playReminder(message) {
  stopPlayback();
  context ||= new AudioContext();
  if (context.state === "suspended") await context.resume();

  const durationMinutes = Math.min(30, Math.max(0.5, Number(message.durationMinutes) || 5));
  const gain = context.createGain();
  gain.gain.value = Math.min(1, Math.max(0, message.volume ?? 0.8));
  gain.connect(context.destination);

  const audioBuffer = await loadAudioBuffer(message);
  if (audioBuffer) {
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = true;
    source.connect(gain);
    trackNode(source);
    source.start();
  } else {
    playSynthPattern(message, gain);
    loopTimer = setInterval(() => playSynthPattern(message, gain), message.sound === "soft" ? 1800 : 1500);
  }

  stopTimer = setTimeout(stopPlayback, durationMinutes * 60 * 1000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "ring") {
    playReminder(message)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "stop") {
    stopPlayback();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
