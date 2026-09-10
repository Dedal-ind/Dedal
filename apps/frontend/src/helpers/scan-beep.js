// scan-beep.js
// Scan feedback a volunteer can hear and feel, so they are not forced to read
// the screen between every participant at a moving queue.
//
// TONES ARE GENERATED, NOT LOADED. A sine wave from an OscillatorNode costs zero
// bytes of network and needs no audio file in the bundle — which matters because
// the gate is exactly where the venue wifi is worst. Success is high and short,
// failure is low and long, so the two are distinguishable without looking and
// without perfect pitch.
//
// HAPTICS ARE ANDROID-ONLY, and that is not a bug to fix. navigator.vibrate is
// unsupported on iOS Safari (Apple has never shipped it) and was removed from
// Firefox in 129. Feature detection is therefore the normal path, not the error
// path — which is why audio carries the feedback on every platform and vibration
// is a bonus on the platforms that have it.
//
// NOTHING HERE MAY THROW. This runs on the critical scan path; a volunteer must
// never lose the scanner because a browser refused an AudioContext.

const MUTE_STORAGE_KEY = 'scannerAudioMuted';

const SUCCESS_TONE = { frequencyHertz: 880, durationMilliseconds: 150, gain: 0.3 };
const FAILURE_TONE = { frequencyHertz: 220, durationMilliseconds: 300, gain: 0.3 };

/*
 * One AudioContext for the whole session, created lazily on the first scan.
 * Constructing one per beep is what exhausts the browser's context limit (Chrome
 * caps it) after a few dozen scans — and a volunteer does hundreds.
 */
let sharedAudioContext = null;

function getAudioContext() {
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return null; // no Web Audio at all — visual feedback still works
  }
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextConstructor();
  }
  /*
   * iOS Safari starts a context "suspended" unless it was created inside a user
   * gesture, and suspends it again whenever the tab backgrounds — which is
   * exactly what happens when a volunteer locks their phone between scans.
   * resume() is the documented recovery; it resolves silently when already
   * running, and its rejection is swallowed because a blocked beep is not an
   * error worth surfacing at a gate.
   */
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}

function playTone({ frequencyHertz, durationMilliseconds, gain }) {
  try {
    const audioContext = getAudioContext();
    if (!audioContext) {
      return;
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequencyHertz;
    gainNode.gain.value = gain;

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    const startTime = audioContext.currentTime;
    const stopTime = startTime + durationMilliseconds / 1000;
    /*
     * Ramped to near-silence rather than cut dead. Stopping a sine mid-cycle
     * produces an audible click, which over a few hundred scans is the thing a
     * volunteer actually complains about. The target is a hair above zero
     * because exponential ramps cannot reach it.
     */
    gainNode.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    oscillator.start(startTime);
    oscillator.stop(stopTime);
  } catch {
    // Autoplay policy, a hostile browser, an exhausted context — all of them
    // mean "no sound", none of them mean "stop scanning".
  }
}

export function isScannerAudioMuted() {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    // Private mode / storage disabled: default to UNMUTED, matching the
    // documented default rather than silently disabling feedback.
    return false;
  }
}

export function setScannerAudioMuted(isMuted) {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, isMuted ? 'true' : 'false');
  } catch {
    // Preference simply does not persist across reloads. Not worth an error.
  }
}

export function playSuccessBeep() {
  playTone(SUCCESS_TONE);
}

export function playFailureBeep() {
  playTone(FAILURE_TONE);
}

/*
 * Vibration patterns. A single buzz reads as "done"; the double-tap reads as
 * "stop and look" without the volunteer having to interpret a duration.
 */
function vibrate(pattern) {
  try {
    if (!('vibrate' in navigator)) {
      return; // iOS Safari, Firefox 129+ — expected, not exceptional
    }
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw when vibration is blocked by a permissions policy
    // rather than returning false.
  }
}

/*
 * The two entry points the scanner actually calls. Mute is checked HERE, once,
 * rather than at every call site — so a muted scanner cannot leak a beep through
 * a path someone forgot to guard.
 */
export function signalScanAccepted() {
  if (isScannerAudioMuted()) {
    return;
  }
  playSuccessBeep();
  vibrate(200);
}

export function signalScanRejected() {
  if (isScannerAudioMuted()) {
    return;
  }
  playFailureBeep();
  vibrate([100, 50, 100]);
}
