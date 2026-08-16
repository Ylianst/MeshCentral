/**
 * @description MeshCentral operator microphone.
 *
 *   Captures the administrator's microphone, encodes it as Opus with the
 *   WebCodecs AudioEncoder and streams it to the managed device, where it is
 *   played through that device's speakers. This is the reverse direction of
 *   agent-audio-0.1.0.js.
 *
 *   Because this makes the operator audible in someone else's room, the agent
 *   asks the device user for permission before any audio is played, and drops
 *   every frame until they agree. Nothing here can bypass that: this module
 *   only requests, it never grants.
 *
 *   Requires: Chrome 94+, Edge 94+, Firefox 130+ (WebCodecs AudioEncoder).
 *   The page must be served over HTTPS for getUserMedia to be available.
 *
 * @version v0.1.0
 *
 * Usage:
 *   var deskMic = CreateAgentMic(desktop);
 *   desktop.m.onMicCaps = function (caps) { deskMic.onCaps(caps); };
 *   deskMic.toggle();
 */

'use strict';

var CreateAgentMic = function (desktop) {
    var obj = {};

    // 'unavailable'  device cannot play audio, or the browser lacks support
    // 'idle'         ready, not transmitting
    // 'requesting'   waiting for the device user to accept or refuse
    // 'live'         transmitting
    obj.state = 'unavailable';
    obj.caps = null;
    obj.level = 0;              // 0..1 input level, for the meter

    obj.onStateChanged = null;  // function (state, detail)
    obj.onLevel = null;         // function (level)

    var SAMPLE_RATE = 48000;
    var FRAME_MS = 20;
    var FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS / 1000;   // 960
    var MNG_MIC_QUERY = 95, MNG_MIC_START = 97, MNG_MIC_STOP = 98, MNG_MIC_DATA = 99;

    var stream = null, actx = null, source = null, worklet = null;
    var encoder = null, seq = 0, pending = [];
    var levelTimer = null, consentTimer = null;

    function setState(state, detail) {
        if (obj.state === state) { return; }
        obj.state = state;
        if (obj.onStateChanged) { try { obj.onStateChanged(state, detail); } catch (ex) { console.log(ex); } }
    }

    function supported() {
        return (typeof AudioEncoder !== 'undefined') &&
               (navigator.mediaDevices != null) &&
               (typeof navigator.mediaDevices.getUserMedia === 'function');
    }

    // ---------------------------------------------------------------------
    // MNG_MIC_CAPS (96) from the agent. Carries both whether the device can
    // play audio at all and whether the user has currently granted consent.
    // ---------------------------------------------------------------------
    obj.onCaps = function (caps) {
        obj.caps = caps;

        if (!caps.playbackAvailable || !supported()) {
            teardown();
            setState('unavailable');
            return;
        }

        if (caps.consentGranted) {
            // The user accepted. Stop waiting and begin sending.
            if (consentTimer) { clearTimeout(consentTimer); consentTimer = null; }
            if (obj.state === 'requesting') { beginCapture(); }
        } else if (obj.state === 'live') {
            // Consent was withdrawn mid-session, or the agent stopped playback.
            stopCapture();
            setState('idle', 'Microphone access ended.');
        } else if (obj.state !== 'requesting') {
            setState('idle');
        }
    };

    // Called when the agent reports the user refused.
    obj.onConsentDenied = function () {
        if (consentTimer) { clearTimeout(consentTimer); consentTimer = null; }
        stopCapture();
        setState('idle', 'The user declined microphone access.');
    };

    // ---------------------------------------------------------------------
    // Ask the device for playback capability and current consent state.
    // ---------------------------------------------------------------------
    obj.query = function () {
        if (desktop && desktop.m && desktop.m.SendMicQuery) { desktop.m.SendMicQuery(); }
    };

    // ---------------------------------------------------------------------
    // Request permission, then capture. Two permissions are involved: the
    // operator's own browser prompt (getUserMedia) and the device user's
    // prompt on the far end. Ask for ours first, so we do not interrupt
    // someone else's work only to discover we have no microphone.
    // ---------------------------------------------------------------------
    obj.start = function () {
        if (obj.state === 'live' || obj.state === 'requesting') { return; }
        if (!supported()) { setState('unavailable', 'This browser cannot encode audio.'); return; }
        if (!obj.caps || !obj.caps.playbackAvailable) { setState('unavailable', 'This device cannot play audio.'); return; }

        setState('requesting', 'Waiting for the user to allow microphone access...');

        navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: SAMPLE_RATE,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        }).then(function (s) {
            stream = s;
            // Ask the device user. Capture only starts when the agent replies
            // with consentGranted, so nothing is transmitted before then.
            if (desktop && desktop.m && desktop.m.SendMicStart) { desktop.m.SendMicStart(); }

            // Do not wait forever: an unattended device would otherwise leave
            // the operator staring at a pending state indefinitely.
            consentTimer = setTimeout(function () {
                consentTimer = null;
                if (obj.state === 'requesting') {
                    stopCapture();
                    setState('idle', 'No response from the user.');
                }
            }, 65000);
        }).catch(function (err) {
            // The operator's own browser or OS refused.
            setState('idle', (err && err.name === 'NotAllowedError')
                ? 'Your browser blocked microphone access.'
                : 'No microphone is available.');
        });
    };

    obj.stop = function () {
        if (desktop && desktop.m && desktop.m.SendMicStop) { desktop.m.SendMicStop(); }
        stopCapture();
        setState('idle');
    };

    obj.toggle = function () {
        if (obj.state === 'live' || obj.state === 'requesting') { obj.stop(); } else { obj.start(); }
    };

    // ---------------------------------------------------------------------
    // Capture pipeline: getUserMedia -> AudioWorklet -> Opus -> MNG_MIC_DATA
    // ---------------------------------------------------------------------
    function beginCapture() {
        if (stream == null) { return; }
        if (actx != null) { return; }   // already running

        try {
            actx = new AudioContext({ sampleRate: SAMPLE_RATE });
        } catch (ex) {
            stopCapture();
            setState('idle', 'Could not open the audio pipeline.');
            return;
        }

        actx.audioWorklet.addModule('scripts/agent-mic-worklet-0.1.0.js').then(function () {
            if (stream == null) { return; }   // stopped while loading

            source = actx.createMediaStreamSource(stream);
            worklet = new AudioWorkletNode(actx, 'mesh-mic-processor');

            encoder = new AudioEncoder({
                output: function (chunk) { sendChunk(chunk); },
                error: function (err) {
                    console.log('MeshMic: encoder error', err);
                    obj.stop();
                }
            });
            encoder.configure({
                codec: 'opus',
                sampleRate: SAMPLE_RATE,
                numberOfChannels: 1,
                bitrate: 28000
            });

            worklet.port.onmessage = function (event) {
                if (obj.state !== 'live') { return; }
                obj.level = event.data.level;
                encodeFrame(event.data.pcm);   // Float32Array, FRAME_SAMPLES long
            };

            source.connect(worklet);
            // Keep the worklet running without echoing the operator's own voice
            // back to them: a zero-gain sink pulls the graph without output.
            var sink = actx.createGain();
            sink.gain.value = 0;
            worklet.connect(sink);
            sink.connect(actx.destination);

            seq = 0;
            setState('live', 'The user can hear you.');
            startLevelMeter();
        }).catch(function (ex) {
            console.log('MeshMic: worklet failed to load', ex);
            stopCapture();
            setState('idle', 'Could not start the microphone.');
        });
    }

    function encodeFrame(pcm) {
        if (encoder == null || encoder.state !== 'configured') { return; }
        try {
            var data = new AudioData({
                format: 'f32-planar',
                sampleRate: SAMPLE_RATE,
                numberOfFrames: pcm.length,
                numberOfChannels: 1,
                timestamp: (seq * FRAME_MS * 1000),
                data: pcm
            });
            encoder.encode(data);
            data.close();
        } catch (ex) { /* a dropped frame is preferable to breaking the stream */ }
    }

    function sendChunk(chunk) {
        if (obj.state !== 'live') { return; }
        if (!desktop || !desktop.m || !desktop.m.SendMicData) { return; }

        var payload = new Uint8Array(chunk.byteLength);
        chunk.copyTo(payload);

        // [type 2][total length 2][seq 2][flags 1][opus payload]
        var total = 7 + payload.length;
        var frame = new Uint8Array(total);
        frame[0] = (MNG_MIC_DATA >> 8) & 0xFF;
        frame[1] = MNG_MIC_DATA & 0xFF;
        frame[2] = (total >> 8) & 0xFF;
        frame[3] = total & 0xFF;
        frame[4] = (seq >> 8) & 0xFF;
        frame[5] = seq & 0xFF;
        frame[6] = 0x00;
        frame.set(payload, 7);
        seq = (seq + 1) & 0xFFFF;

        desktop.m.SendMicData(frame);
    }

    function startLevelMeter() {
        if (levelTimer) { return; }
        levelTimer = setInterval(function () {
            if (obj.onLevel) { try { obj.onLevel(obj.level); } catch (ex) { } }
        }, 100);
    }

    function stopCapture() {
        if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
        if (consentTimer) { clearTimeout(consentTimer); consentTimer = null; }
        teardown();
        obj.level = 0;
        if (obj.onLevel) { try { obj.onLevel(0); } catch (ex) { } }
    }

    function teardown() {
        if (encoder != null) { try { encoder.close(); } catch (ex) { } encoder = null; }
        if (worklet != null) { try { worklet.disconnect(); } catch (ex) { } worklet = null; }
        if (source != null) { try { source.disconnect(); } catch (ex) { } source = null; }
        if (actx != null) { try { actx.close(); } catch (ex) { } actx = null; }
        // Release the microphone so the browser's recording indicator clears;
        // leaving it open would suggest we are still listening.
        if (stream != null) {
            try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (ex) { }
            stream = null;
        }
        pending = [];
    }

    return obj;
};
