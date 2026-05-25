let ctx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

function getContext() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function playBurst(audioCtx: AudioContext, gain: GainNode) {
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  osc1.frequency.value = 440;
  osc2.frequency.value = 480;
  osc1.connect(gain);
  osc2.connect(gain);
  osc1.start();
  osc2.start();
  osc1.stop(audioCtx.currentTime + 1);
  osc2.stop(audioCtx.currentTime + 1);
}

export function startRinging() {
  stopRinging();
  const audioCtx = getContext();
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.15;
  gainNode.connect(audioCtx.destination);

  playBurst(audioCtx, gainNode);
  intervalId = setInterval(() => {
    if (gainNode) playBurst(audioCtx, gainNode);
  }, 3000);
}

export function stopRinging() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (gainNode) {
    gainNode.disconnect();
    gainNode = null;
  }
}
