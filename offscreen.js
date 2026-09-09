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
let stopTimer;
let playbackVersion = 0;
const activeNodes = new Set();

function stopPlayback() {
  clearTimeout(stopTimer);
  stopTimer = undefined;
  playbackVersion += 1;
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

function createSynthLoopBuffer(sound) {
  const soft = sound === "soft";
  const loopSeconds = soft ? 1.8 : 1.2;
  const frameCount = Math.ceil(context.sampleRate * loopSeconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  const notes = soft
    ? [{ at: 0, length: 0.3, frequency: 520 }, { at: 0.45, length: 0.3, frequency: 660 }]
    : [
      { at: 0, length: 0.17, frequency: 880 },
      { at: 0.24, length: 0.17, frequency: 660 },
      { at: 0.48, length: 0.17, frequency: 880 },
      { at: 0.72, length: 0.17, frequency: 660 }
    ];

  for (const note of notes) {
    const start = Math.floor(note.at * context.sampleRate);
    const end = Math.min(frameCount, Math.ceil((note.at + note.length) * context.sampleRate));
    for (let frame = start; frame < end; frame += 1) {
      const elapsed = (frame - start) / context.sampleRate;
      const remaining = (end - frame) / context.sampleRate;
      const envelope = Math.min(1, elapsed / 0.015, remaining / 0.06);
      const phase = Math.PI * 2 * note.frequency * elapsed;
      const wave = soft ? Math.sin(phase) : (Math.sin(phase) >= 0 ? 1 : -1);
      samples[frame] += wave * envelope * (soft ? 0.28 : 0.2);
    }
  }
  return buffer;
}

async function loadAudioBuffer(message) {
  if (message.sound === "alarm" || message.sound === "soft") {
    return createSynthLoopBuffer(message.sound);
  }
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
  const version = playbackVersion;
  context ||= new AudioContext();
  if (context.state === "suspended") await context.resume();

  const durationMinutes = Math.min(30, Math.max(0.5, Number(message.durationMinutes) || 5));
  const gain = context.createGain();
  gain.gain.value = Math.min(1, Math.max(0, message.volume ?? 0.8));
  gain.connect(context.destination);

  const audioBuffer = await loadAudioBuffer(message);
  if (version !== playbackVersion) return;
  if (!audioBuffer) throw new Error("未找到可播放的铃声");

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.loop = true;
  source.connect(gain);
  trackNode(source);
  source.start();

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
