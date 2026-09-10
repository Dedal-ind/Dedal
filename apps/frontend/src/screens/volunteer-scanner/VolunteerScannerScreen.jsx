// VolunteerScannerScreen.jsx
// Route: /backstage/scanner?checkpointId=xxx — the volunteer's checkpoint scanner.
//
// A dark, full-screen tool. It resolves the checkpoint and whether a shift is
// active from GET /shifts/mine; with no active shift the camera never starts.
// QR frames are decoded with jsQR and posted to POST /scans/qr (or /scans/manual
// for a backup code). A screen wake lock keeps the display awake during a shift.
//
// THE REDESIGN, and what it changed about the SHAPE of feedback:
//
// Every scan used to take over the whole screen for 2.5 seconds with a card the
// volunteer then had to dismiss. That is a modal between the volunteer and the
// next person in the queue — the camera is gone, the viewfinder has to be
// re-found, and at a busy gate the volunteer starts tapping SCAN NEXT blind.
// The result now lands in a fixed 80px strip at the bottom that never moves and
// never covers the feed, plus a 120ms flash of the viewport itself: white for
// accepted, --primary for rejected. The volunteer's eyes never leave the frame.
//
// NOTHING ON THIS SCREEN ANIMATES. No sweep line (the rule that drove it has
// been deleted from index.css), no pulse on the shift dot, no skeletons, no
// press scale, no GSAP. The two exceptions are the 120ms CSS background flash
// above and the backup sheet's CSS transform slide. This is a gate tool on a
// mid-range Android phone and every spare frame belongs to the decode loop.
//
// THE DECODE PATH IS UNCHANGED. jsQR-from-canvas, the 3s dedup window, the wake
// lock, the every-200-scans stream recycle and the haptic/tone feedback are the
// same code they were; this change is layout and presentation only.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import apiClient from '../../api-client/api-client.js';
import {
  SCANNER_COPY,
  SCAN_REJECTION_MESSAGES,
  CAMPUS_ACCESS_COPY,
} from '../../brand/brand-copy.js';
import {
  signalScanAccepted,
  signalScanRejected,
  isScannerAudioMuted,
  setScannerAudioMuted,
} from '../../helpers/scan-beep.js';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import {
  BackIcon,
  CheckIcon,
  CloseIcon,
  KeypadIcon,
  SoundOffIcon,
  SoundOnIcon,
  TorchIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import BackupCodeSheet, { BACKUP_CODE_LENGTH } from './BackupCodeSheet.jsx';

const RESULT_DISPLAY_MS = 2500;
const DEDUP_WINDOW_MS = 3000;
// The whole point of the flash is that it is over before the volunteer has
// finished reading the name. Long enough to register, too short to wait on.
const FLASH_MS = 120;
// A volunteer works a whole day on one screen; the stream is rebuilt this often.
const SCANS_BEFORE_STREAM_RECYCLE = 200;
/*
 * The mobile-only cutoff. Matches the app's desktop breakpoint: >768px is a
 * desktop, and a desktop has no rear camera worth pointing at a pass.
 */
const DESKTOP_QUERY = '(min-width: 769px)';

function generateClientScanId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `scan-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// First letters of the first two name parts — the avatar monogram.
function initialsOf(fullName) {
  return (
    (fullName || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  );
}

function formatScanTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/*
 * The viewport width, as a subscription rather than a resize listener that
 * setStates on every pixel. matchMedia fires only when the answer CHANGES, so
 * rotating a phone does not re-render the scanner sixty times.
 */
function subscribeToDesktop(onChange) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function readIsDesktop() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function VolunteerScannerScreen() {
  // Not useNavigate: the scanner is on the view-transition exemption list
  // (components/route-transition/view-transition-policy.js matches
  // /backstage/scanner in BOTH directions) and this hook is what honours it.
  const navigate = useTransitionNavigate();
  const [searchParams] = useSearchParams();
  const checkpointId = searchParams.get('checkpointId');
  /*
   * The coordinator's event page opens the scanner with ?eventId= — it knows
   * the event, not the checkpoint. Resolved below against /checkpoints/mine:
   * prefer the checkpoint bound to that event, fall back to a fest-wide one.
   * The scanner previously read only checkpointId, so every coordinator
   * arrival matched nothing and the screen sat dead.
   */
  const requestedEventId = searchParams.get('eventId');

  const isDesktop = useSyncExternalStore(subscribeToDesktop, readIsDesktop);

  const [checkpoint, setCheckpoint] = useState(null);
  const [shiftActive, setShiftActive] = useState(null); // null=loading, true/false
  const [mode, setMode] = useState('qr'); // 'qr' | 'backup'
  const [result, setResult] = useState(null); // { accepted, reason?, participantName?, ... }
  /*
   * The scan-then-confirm flow: a decoded QR first fetches WHO this is
   * (read-only preview), shows their details, and waits for CHECK IN / CHECK OUT.
   */
  const [pendingScan, setPendingScan] = useState(null);
  const [cameraError, setCameraError] = useState(false);
  // Read once from localStorage so the preference survives a reload — a
  // volunteer should not have to re-mute every time the camera recycles.
  // helpers/scan-beep.js is the single source of truth for the mute flag; this
  // is a mirror for rendering, and every write goes back through the helper.
  const [isAudioMuted, setIsAudioMuted] = useState(isScannerAudioMuted);
  // Torch: supported only where the camera track exposes the capability
  // (Android Chrome, mostly). The button is DISABLED, not hidden, where it is
  // unreal — the action row is two equal halves and dropping one mid-shift
  // would move the other under the volunteer's thumb.
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  // Scan direction — only meaningful (and adjustable) at an inAndOut checkpoint;
  // an inOnly checkpoint stays 'in'. Mirrored to a ref so the stable submit
  // callback reads the latest choice without being re-created.
  const directionRef = useRef('in');
  const chooseDirection = (nextDirection) => {
    directionRef.current = nextDirection;
  };

  /*
   * The bottom panel's entry. Deliberately SEPARATE from `result`: `result`
   * self-clears after RESULT_DISPLAY_MS because that timer also releases the
   * busy lock, but the strip has to keep showing the last scan until the next
   * one replaces it. An 80px hole opening up 2.5s after every scan is exactly
   * the layout shift this design is trying to remove.
   */
  const [lastEntry, setLastEntry] = useState(null);
  const [scannedCount, setScannedCount] = useState(0);
  const [flash, setFlash] = useState(null); // 'accept' | 'reject' | null

  const videoReference = useRef(null);
  const canvasReference = useRef(null);
  const streamReference = useRef(null);
  const lastScanRef = useRef({ code: null, at: 0 });
  const isBusyRef = useRef(false);
  const animationRef = useRef(null);
  /*
   * LEAK FIX: the result auto-dismiss timeout used to be fired and forgotten. On
   * unmount within its 2.5s window it still ran, calling setState on a dead
   * component and keeping that render's whole closure alive. Held in a ref so
   * unmount can clear it.
   */
  const resultTimeoutRef = useRef(null);
  // Same reasoning for the 120ms flash: short, but not shorter than a tap on
  // the back arrow.
  const flashTimeoutRef = useRef(null);
  /*
   * LEAK FIX (D.4): long camera sessions accumulate decoded frame buffers —
   * Android WebView especially. The stream is recycled every
   * SCANS_BEFORE_STREAM_RECYCLE scans, which is the standard mitigation.
   */
  const scanCountRef = useRef(0);
  const [cameraGeneration, setCameraGeneration] = useState(0);

  // Resolve the checkpoint from GET /checkpoints/mine (the only volunteer-reachable
  // source of checkpointName AND directionMode) and the active-shift status from
  // GET /shifts/mine. The shift DTO is FLAT — checkpointId is a string, not a
  // populated object; the old populated-object assumption meant no shift ever
  // matched, so the camera never started even during a live shift.
  useEffect(() => {
    let isActive = true;
    Promise.all([
      apiClient.get('/checkpoints/mine').catch(() => []),
      apiClient.get('/shifts/mine').catch(() => ({ shifts: [] })),
      apiClient.get('/staff-assignments/mine').catch(() => []),
    ])
      .then(([checkpointList, shiftPayload, assignmentList]) => {
        if (!isActive) {
          return;
        }
        const checkpoints = Array.isArray(checkpointList) ? checkpointList : [];
        const resolved = checkpointId
          ? checkpoints.find((candidate) => candidate.id === checkpointId) ?? null
          : requestedEventId
            ? /* Event arrival: the checkpoint bound to this event wins; a
               * fest-wide gate (no eventId) is the fallback. */
              checkpoints.find((candidate) => candidate.eventId === requestedEventId) ??
              checkpoints.find((candidate) => !candidate.eventId) ??
              null
            : (checkpoints[0] ?? null);
        setCheckpoint(resolved);
        const resolvedCheckpointId = resolved?.id ?? null;

        /*
         * Shifts exist for VOLUNTEERS only — the server refuses to create one
         * for a coordinator, and scan authorization passes coordinators with
         * no shift at all. Gating the camera on a shift therefore locked out
         * exactly the people the server authorizes; the server remains the
         * enforcement point either way, since an off-shift volunteer's scan is
         * recorded as rejected.
         */
        const assignments = Array.isArray(assignmentList) ? assignmentList : [];
        const isShiftExempt = assignments.some(
          (assignment) =>
            (assignment.role === 'coordinator' || assignment.role === 'administrator') &&
            assignment.status === 'active',
        );

        const shifts = Array.isArray(shiftPayload?.shifts) ? shiftPayload.shifts : [];
        const now = Date.now();
        setShiftActive(
          isShiftExempt ||
          shifts.some((shift) => {
            const shiftCheckpointId =
              shift.checkpointId && typeof shift.checkpointId === 'object'
                ? shift.checkpointId.id
                : shift.checkpointId;
            if (String(shiftCheckpointId) !== resolvedCheckpointId || shift.status === 'cancelled') {
              return false;
            }
            const start = shift.startsAt ? new Date(shift.startsAt).getTime() : null;
            const end = shift.endsAt ? new Date(shift.endsAt).getTime() : null;
            return start !== null && end !== null && now >= start && now <= end;
          }),
        );
      })
      .catch(() => {
        if (isActive) {
          setShiftActive(false);
        }
      });
    return () => {
      isActive = false;
    };
  }, [checkpointId, requestedEventId]);

  // Screen wake lock while the scanner is open.
  useEffect(() => {
    let wakeLockSentinel = null;
    /*
     * LEAK FIX: request() is async. Unmounting before it resolved left the
     * cleanup with a null sentinel — a silent no-op — and the lock was then
     * acquired and held forever, keeping the screen awake on a screen the
     * volunteer had already left. The flag releases a late arrival immediately.
     */
    let isCancelled = false;
    if ('wakeLock' in navigator) {
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (isCancelled) {
            sentinel.release?.().catch(() => {});
            return;
          }
          wakeLockSentinel = sentinel;
        })
        .catch(() => {});
    }
    return () => {
      isCancelled = true;
      wakeLockSentinel?.release?.().catch(() => {});
    };
  }, []);

  // LEAK FIX: neither timer may outlive the screen.
  useEffect(
    () => () => {
      window.clearTimeout(resultTimeoutRef.current);
      window.clearTimeout(flashTimeoutRef.current);
    },
    [],
  );

  // The one piece of motion on the scan path, and it is a class for 120ms.
  const triggerFlash = useCallback((kind) => {
    window.clearTimeout(flashTimeoutRef.current);
    setFlash(kind);
    flashTimeoutRef.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  const submitScan = useCallback(
    async (method, codeValue, directionOverride = null) => {
      if (isBusyRef.current) {
        return;
      }
      // 3s dedup: the same code within the window is ignored. This is scan time —
      // a runtime value read when a scan fires, not during render.
      const now = Date.now();
      if (lastScanRef.current.code === codeValue && now - lastScanRef.current.at < DEDUP_WINDOW_MS) {
        return;
      }
      lastScanRef.current = { code: codeValue, at: now };
      isBusyRef.current = true;

      const body = {
        checkpointId,
        clientScanId: generateClientScanId(),
        // The backend validator requires scannedAt (ISO 8601); without it every
        // scan 400s. Derived from the dedup timestamp above (new Date(number) is
        // deterministic). Direction comes from a ref so this callback stays stable
        // for the camera loop while an in/out toggle can still change it.
        scannedAt: new Date(now).toISOString(),
        direction: directionOverride ?? directionRef.current,
        ...(method === 'qr' ? { qrToken: codeValue } : { backupCode: codeValue }),
      };
      try {
        const scanResult = await apiClient.post(method === 'qr' ? '/scans/qr' : '/scans/manual', body);
        const accepted = scanResult.result === 'accepted' || scanResult.result === 'manualOverride';
        // The accepted envelope nests identity under `participant`
        // ({ fullName, usn, collegeName, photoUrl }); there is no entitlementType.
        setResult({
          accepted,
          reason: scanResult.result,
          participantName: scanResult.participant?.fullName ?? null,
          direction: directionOverride ?? directionRef.current,
          /*
           * Present only on an accepted INBOUND MAIN GATE scan. Carries
           * { isReEntry, firstCheckedInAt } — the gate is the one checkpoint
           * where "accepted" has two meanings and the volunteer has to act
           * differently on each.
           */
          gateEntry: scanResult.gateEntry ?? null,
        });
        /*
         * The strip and the flash update at the SAME moment, deliberately: the
         * flash is what pulls the eye and the strip is what it lands on, and a
         * strip that arrives a frame later reads as a second, separate event.
         */
        setLastEntry({
          accepted,
          name:
            scanResult.participant?.fullName ??
            (accepted ? SCANNER_COPY.unknownParticipant : SCANNER_COPY.accessDenied),
          // A rejection has to say WHY in the strip; there is no card left to
          // put it on, and "denied" without a reason is unactionable at a gate.
          reason: accepted
            ? null
            : SCAN_REJECTION_MESSAGES[scanResult.result] ?? SCANNER_COPY.errorMessage,
          // The one rejection with an obvious remedy carries the remedy.
          hint: scanResult.result === 'rejectedMainGateRequired' ? CAMPUS_ACCESS_COPY.mainGateHint : null,
          /*
           * The main gate is the one checkpoint where "accepted" has two
           * meanings. A re-entry rides on the timestamp line with the original
           * arrival time, so the volunteer can repeat a fact back to somebody
           * who says they have not been in yet, rather than assert one.
           */
          note:
            scanResult.gateEntry?.isReEntry && scanResult.gateEntry.firstCheckedInAt
              ? `${CAMPUS_ACCESS_COPY.reEntry} · ${CAMPUS_ACCESS_COPY.reEntrySince(
                  formatScanTime(scanResult.gateEntry.firstCheckedInAt),
                )}`
              : null,
          at: now,
        });
        setScannedCount((previous) => previous + 1);
        triggerFlash(accepted ? 'accept' : 'reject');
        // Auto-flip direction for inAndOut checkpoints so the volunteer does
        // not have to manually toggle after every scan. Check-in → next scan
        // defaults to check-out, and vice versa.
        if (accepted && checkpoint?.directionMode === 'inAndOut') {
          chooseDirection(directionRef.current === 'in' ? 'out' : 'in');
        }
        /*
         * Was a bare navigator.vibrate — which meant NO feedback at all on iOS
         * Safari or Firefox 129+, neither of which implements it. The helper
         * pairs a generated tone (every platform) with the buzz (Android), and
         * owns the mute check so a silenced scanner cannot leak sound through a
         * path that forgot to ask. One pulse for accepted, two short ones for
         * rejected — distinguishable in a pocket, without looking.
         */
        if (accepted) {
          signalScanAccepted();
        } else {
          signalScanRejected();
        }
      } catch {
        setResult({ accepted: false, reason: 'error' });
        setLastEntry({
          accepted: false,
          name: SCANNER_COPY.accessDenied,
          reason: SCANNER_COPY.errorMessage,
          hint: null,
          note: null,
          at: now,
        });
        triggerFlash('reject');
        // A network failure is a failed scan to the person holding the queue up.
        signalScanRejected();
      } finally {
        window.clearTimeout(resultTimeoutRef.current);
        resultTimeoutRef.current = window.setTimeout(() => {
          setResult(null);
          isBusyRef.current = false;
        }, RESULT_DISPLAY_MS);

        // Recycle the camera every N scans (see SCANS_BEFORE_STREAM_RECYCLE).
        scanCountRef.current += 1;
        if (scanCountRef.current % SCANS_BEFORE_STREAM_RECYCLE === 0) {
          setCameraGeneration((generation) => generation + 1);
        }
      }
    },
    [checkpointId, checkpoint?.directionMode, triggerFlash],
  );

  /*
   * Step one of every scan: preview. On success, show the card; on unknown pass
   * or network failure, fall back to the old direct-record flow so a flaky
   * network never blocks the queue.
   */
  const requestPreview = useCallback(
    async (method, codeValue) => {
      if (isBusyRef.current) return;
      const now = Date.now();
      if (lastScanRef.current.code === codeValue && now - lastScanRef.current.at < DEDUP_WINDOW_MS) return;
      lastScanRef.current = { code: codeValue, at: now };
      isBusyRef.current = true;
      try {
        const preview = await apiClient.post('/scans/preview', {
          checkpointId,
          ...(method === 'qr' ? { qrToken: codeValue } : { backupCode: codeValue }),
        });
        if (!preview?.passFound) {
          isBusyRef.current = false;
          lastScanRef.current = { code: '', at: 0 };
          await submitScan(method, codeValue);
          return;
        }
        setPendingScan({ method, code: codeValue, preview });
      } catch {
        isBusyRef.current = false;
        lastScanRef.current = { code: '', at: 0 };
        await submitScan(method, codeValue);
      }
    },
    [checkpointId, submitScan],
  );

  function confirmPendingScan(chosenDirection) {
    if (!pendingScan) return;
    const { method, code } = pendingScan;
    setPendingScan(null);
    isBusyRef.current = false;
    lastScanRef.current = { code: '', at: 0 };
    submitScan(method, code, chosenDirection);
  }

  function cancelPendingScan() {
    setPendingScan(null);
    isBusyRef.current = false;
    lastScanRef.current = { code: '', at: 0 };
  }

  /*
   * Camera + jsQR loop (QR mode, active shift, MOBILE).
   *
   * isDesktop is a real gate on the effect, not a display rule: hiding the
   * viewport while getUserMedia still ran would leave a camera light on behind
   * a "open this on your phone" message, which is the worst of both.
   */
  useEffect(() => {
    if (mode !== 'qr' || shiftActive !== true || isDesktop) {
      return undefined;
    }
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamReference.current = stream;
        // Torch support is a property of THIS track; probe it once per stream.
        const [videoTrack] = stream.getVideoTracks();
        setIsTorchSupported(Boolean(videoTrack?.getCapabilities?.().torch));
        setIsTorchOn(false);
        if (videoReference.current) {
          videoReference.current.srcObject = stream;
          await videoReference.current.play().catch(() => {});
        }
        scanFrame();
      } catch {
        setCameraError(true);
      }
    }

    function scanFrame() {
      if (cancelled) {
        return;
      }
      const video = videoReference.current;
      const canvas = canvasReference.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA && !isBusyRef.current) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height);
        if (decoded?.data) {
          requestPreview('qr', decoded.data.trim());
        }
      }
      animationRef.current = window.requestAnimationFrame(scanFrame);
    }

    startCamera();
    // Captured now: the ref may point elsewhere by the time cleanup runs, and
    // it is THIS element's stream reference that has to be released.
    const videoElement = videoReference.current;
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      streamReference.current?.getTracks().forEach((track) => track.stop());
      streamReference.current = null;
      /*
       * LEAK FIX: stopping the tracks does NOT release the <video> element's
       * reference to the MediaStream — the element keeps the object and its
       * decoded frame buffers alive, which is the leak that makes a 6-hour
       * scanner session sluggish. Clearing srcObject is what actually frees it.
       */
      if (videoElement) {
        videoElement.srcObject = null;
      }
    };
    // cameraGeneration is a deliberate dependency: bumping it tears the stream
    // down and builds a fresh one (the every-200-scans recycle).
  }, [mode, shiftActive, isDesktop, requestPreview, cameraGeneration]);

  // Torch toggle — applied to the live track; failures just leave it off.
  async function handleToggleTorch() {
    const [videoTrack] = streamReference.current?.getVideoTracks() ?? [];
    if (!videoTrack) {
      return;
    }
    const nextOn = !isTorchOn;
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: nextOn }] });
      setIsTorchOn(nextOn);
    } catch {
      // Unsupported after all — disable the button rather than leave it dead.
      setIsTorchSupported(false);
    }
  }

  const checkpointName = checkpoint?.checkpointName ?? '—';

  /*
   * The top bar. Identical in every state of this screen, including the ones
   * with no camera — a volunteer who opened the wrong checkpoint still needs
   * the name and the way back.
   */
  function renderTopBar({ withScanControls }) {
    return (
      <header className="dvs-topbar">
        <button
          type="button"
          className="dvs-iconbutton dvs-topbar__back"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <BackIcon size="lg" />
        </button>
        <h1 className="dvs-topbar__title">{checkpointName}</h1>
        {withScanControls ? (
          <>
            {/*
              Some venues (auditoriums mid-performance, exam halls) prohibit
              device sound outright. Without this the volunteer's only options
              are leaving the scanner to find system settings or silencing their
              whole phone — so the toggle lives here, one tap from the frame.
              The value is owned by helpers/scan-beep.js; this only mirrors it.
            */}
            <button
              type="button"
              className="dvs-iconbutton dvs-topbar__mute"
              onClick={() => {
                const nextMuted = !isAudioMuted;
                setIsAudioMuted(nextMuted);
                setScannerAudioMuted(nextMuted);
              }}
              aria-pressed={isAudioMuted}
              aria-label={isAudioMuted ? SCANNER_COPY.unmuteAudio : SCANNER_COPY.muteAudio}
            >
              {isAudioMuted ? <SoundOffIcon /> : <SoundOnIcon />}
            </button>
            <p className="dvs-topbar__count">{`${scannedCount} scanned`}</p>
          </>
        ) : null}
      </header>
    );
  }

  // Desktop → no camera, no decode loop. Just the way to get to a phone.
  if (isDesktop) {
    return (
      <div className="dvs-root">
        {renderTopBar({ withScanControls: false })}
        <div className="dvs-empty">
          <h2 className="dvs-empty__title">Open on your phone</h2>
          <p className="dvs-empty__body">
            The scanner needs a rear camera. Scan this with the phone you will be working the gate on.
          </p>
          <div className="dvs-empty__qr">
            <QRCodeSVG value={window.location.href} size={160} level="M" />
          </div>
        </div>
      </div>
    );
  }

  // No active shift → gate, no camera.
  if (shiftActive === false) {
    return (
      <div className="dvs-root">
        {renderTopBar({ withScanControls: false })}
        <div className="dvs-empty">
          <h2 className="dvs-empty__title">{SCANNER_COPY.noActiveShiftTitle}</h2>
          <p className="dvs-empty__body">{SCANNER_COPY.noActiveShiftSubtext}</p>
          <button type="button" className="dvs-ghost" onClick={() => navigate('/backstage')}>
            Go to backstage
          </button>
        </div>
      </div>
    );
  }

  const viewportClassName = [
    'dvs-viewport',
    flash === 'accept' ? 'dvs-viewport--flash-accept' : '',
    flash === 'reject' ? 'dvs-viewport--flash-reject' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="dvs-root">
      {renderTopBar({ withScanControls: true })}

      <div className="dvs-stage">
        <video ref={videoReference} className="dvs-stage__video" playsInline muted />
        <canvas ref={canvasReference} className="dvs-canvas" />

        {/*
          The square target. Its box-shadow is the vignette; its background is
          the flash. Four static L-brackets, no sweep line: a laser that never
          stops repainting over a live video feed is a permanent cost for a
          decoration, and it also implies the scanner is "searching" when in
          fact it decodes every frame regardless.
        */}
        <div className={viewportClassName} aria-hidden="true">
          <span className="dvs-corner dvs-corner--tl" />
          <span className="dvs-corner dvs-corner--tr" />
          <span className="dvs-corner dvs-corner--bl" />
          <span className="dvs-corner dvs-corner--br" />
        </div>

        {cameraError ? <p className="dvs-stage__notice">{SCANNER_COPY.cameraDenied}</p> : null}
      </div>

      <div className="dvs-panel">
        {/*
          THE LAST SCAN. A fixed-height strip that is always present — empty it
          says so in words rather than as a pulsing placeholder, because a
          skeleton here would be mistaken for a scan still in flight.
          aria-live so a volunteer using VoiceOver hears the outcome without
          having to go looking for it.
        */}
        <div className="dvs-result" aria-live="polite">
          {lastEntry ? (
            <>
              <span
                className={`dvs-result__avatar${lastEntry.accepted ? '' : ' dvs-result__avatar--rejected'}`}
                aria-hidden="true"
              >
                {lastEntry.accepted ? initialsOf(lastEntry.name) : '!'}
              </span>
              <span className="dvs-result__text">
                <span className={lastEntry.accepted ? 'dvs-result__name' : 'dvs-result__reason'}>
                  {lastEntry.accepted ? lastEntry.name : (lastEntry.hint ?? lastEntry.reason)}
                </span>
                <span className="dvs-result__time">
                  {lastEntry.note
                    ? `${formatScanTime(lastEntry.at)} · ${lastEntry.note}`
                    : formatScanTime(lastEntry.at)}
                </span>
              </span>
              <span className="dvs-result__mark">
                {lastEntry.accepted ? <CheckIcon size="lg" /> : <CloseIcon size="lg" />}
              </span>
            </>
          ) : (
            <span className="dvs-result--empty">{SCANNER_COPY.alignHint}</span>
          )}
        </div>

        <div className="dvs-actions">
          <button
            type="button"
            className={`dvs-action${isTorchOn ? ' dvs-action--on' : ''}`}
            onClick={handleToggleTorch}
            /* Torch is a capability of the live camera track. Where the browser
               does not expose it the button stays in place and goes dead, so
               the row's two halves never move under the thumb. */
            disabled={!isTorchSupported}
            aria-pressed={isTorchOn}
            aria-label={isTorchOn ? SCANNER_COPY.flashlightOff : SCANNER_COPY.flashlightOn}
          >
            <TorchIcon filled={isTorchOn} />
            <span className="dvs-action__label">Torch</span>
          </button>
          <button
            type="button"
            className="dvs-action"
            /* Opening the sheet switches mode, which tears the camera down.
               Deliberate: the sheet covers the frame anyway, and a decode loop
               running behind an open keypad can fire a second scan under the
               volunteer's fingers. */
            onClick={() => setMode('backup')}
          >
            <KeypadIcon />
            <span className="dvs-action__label">Enter code</span>
          </button>
        </div>
      </div>

      {mode === 'backup' ? (
        <BackupCodeSheet
          onSubmit={(code) => {
            if (code.length !== BACKUP_CODE_LENGTH) return;
            setMode('qr');
            requestPreview('backup', code);
          }}
          onCancel={() => setMode('qr')}
        />
      ) : null}

      {/*
        Scan-then-confirm. This is NOT scan feedback — the feedback is the flash
        and the strip. This is a DECISION the volunteer has to make before the
        scan is recorded at all, at an in-and-out checkpoint, and a decision
        needs somewhere to be made. Static: no slide, no scrim fade.
      */}
      {pendingScan && !result ? (
        <div className="dvs-scrim" role="dialog" aria-modal="true">
          <div className="dvs-sheet">
            <div className="dvs-sheet__identity">
              <span className="dvs-result__avatar" aria-hidden="true">
                {initialsOf(pendingScan.preview.participant?.fullName)}
              </span>
              <span className="dvs-result__text">
                <span className="dvs-result__name">
                  {pendingScan.preview.participant?.fullName ?? SCANNER_COPY.unknownParticipant}
                </span>
                <span className="dvs-sheet__meta">
                  {[pendingScan.preview.participant?.usn, pendingScan.preview.participant?.collegeName]
                    .filter(Boolean)
                    .join(' · ')}
                  {pendingScan.preview.lastAcceptedDirection === 'in'
                    ? ` · ${SCANNER_COPY.currentlyInside}`
                    : ''}
                </span>
              </span>
            </div>

            <div className="dvs-sheet__choices">
              <button
                type="button"
                className="dvs-choice dvs-choice--primary"
                onClick={() => confirmPendingScan('in')}
              >
                {SCANNER_COPY.checkInButton}
              </button>
              {pendingScan.preview.checkpoint?.directionMode === 'inAndOut' ? (
                <button type="button" className="dvs-choice" onClick={() => confirmPendingScan('out')}>
                  {SCANNER_COPY.checkOutButton}
                </button>
              ) : null}
            </div>

            <div className="dvs-sheet__footer">
              <button type="button" className="dvs-textaction" onClick={cancelPendingScan}>
                {SCANNER_COPY.cancelScan}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default VolunteerScannerScreen;
