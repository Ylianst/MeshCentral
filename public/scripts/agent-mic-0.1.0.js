/**
 * @description MeshCentral remote microphone listener.
 *
 *   Plays the managed device's microphone in the operator's browser, so an
 *   administrator can hear the person at that machine and any noise worth
 *   diagnosing, such as fans or clicking drives.
 *
 *   This never touches the operator's own microphone: audio travels one way,
 *   device -> browser, exactly like the speaker feature in
 *   agent-audio-0.1.0.js. The only difference is which source the agent
 *   captures.
 *
 *   The device's user is asked before their microphone is opened, and the
 *   agent refuses to capture until they accept. This module only requests;
 *   it can never grant.
 *
 *   Requires: Chrome 94+, Edge 94+, Firefox 130+ (WebCodecs AudioDecoder).
 *
 * @version v0.1.0
 *
 * Usage:
 *   var deskMic = CreateAgentMic(desktop);
 *   desktop.m.onMicCaps = function (caps) { deskMic.onCaps(caps); };
 *   desktop.m.onMicData = function (view) { deskMic.onData(view); };
 *   deskMic.toggle();
 */

'use strict';

var CreateAgentMic = function (desktop) {
    var obj = {};

    // 'unavailable'  device has no microphone, or the browser cannot decode
    // 'idle'         ready, not listening
    // 'requesting'   waiting for the device user to accept or refuse
    // 'live'         listening
    obj.state = 'unavailable';
    obj.caps = null;
    obj.level = 0;              // 0..1 output level, for the meter
    obj.params = null;          // resolved encoder settings, or null = agent default

    obj.onStateChanged = null;  // function (state, detail)
    obj.onLevel = null;         // function (level)

    var SAMPLE_RATE = 48000;
    var JITTER_MIN = 2, JITTER_MAX = 8;

    var actx = null, worklet = null, decoder = null;
    var jitter = [], nextSeq = -1, jitterDepth = 3, gapCount = 0;
    var gapTimer = null, consentTimer = null, levelTimer = null;

    function setState(state, detail) {
        if (obj.state === state) { return; }
        obj.state = state;
        if (obj.onStateChanged) { try { obj.onStateChanged(state, detail); } catch (ex) { console.log(ex); } }
    }

    function supported() { return (typeof AudioDecoder !== 'undefined'); }

    // ---------------------------------------------------------------------
    // MNG_MIC_CAPS (96): whether the device has a usable microphone, and
    // whether its user has currently granted permission.
    // ---------------------------------------------------------------------
    obj.onCaps = function (caps) {
        obj.caps = caps;

        if (!caps.captureAvailable || !supported()) {
            teardown();
            setState('unavailable');
            return;
        }

        if (caps.consentGranted) {
            if (consentTimer) { clearTimeout(consentTimer); consentTimer = null; }
            // The user accepted, so audio is about to arrive: open the player.
            if (obj.state !== 'live') { beginPlayback(); }
        } else if (obj.state === 'live') {
            // Withdrawn mid-session, or the agent stopped capturing.
            teardown();
            setState('idle', 'Microphone access ended.');
        } else if (obj.state !== 'requesting') {
            setState('idle');
        }
    };

    // The agent reports an explicit refusal.
    obj.onConsentDenied = function () {
        if (consentTimer) { clearTimeout(consentTimer); consentTimer = null; }
        teardown();
        setState('idle', 'The user declined the microphone request.');
    };

    obj.query = function () {
        if (desktop && desktop.m && desktop.m.SendMicQuery) { desktop.m.SendMicQuery(); }
    };

    // ---------------------------------------------------------------------
    // Ask the device user for permission. Nothing is captured or played until
    // the agent confirms they accepted.
    // ---------------------------------------------------------------------
    obj.start = function () {
        if (obj.state === 'live' || obj.state === 'requesting') { return; }
        if (!supported()) { setState('unavailable', 'This browser cannot decode audio.'); return; }
        if (!obj.caps || !obj.caps.captureAvailable) { setState('unavailable', 'This device has no microphone.'); return; }

        setState('requesting', 'Asking the user for permission to use their microphone...');
        if (desktop && desktop.m && desktop.m.SendMicStart) { desktop.m.SendMicStart(obj.params); }

        // An unattended machine would otherwise leave the operator waiting
        // indefinitely with no indication of what is happening.
        consentTimer = setTimeout(function () {
            consentTimer = null;
            if (obj.state === 'requesting') {
                obj.stop();
                setState('idle', 'No response from the user.');
            }
        }, 65000);
    };

    obj.stop = function () {
        if (desktop && desktop.m && desktop.m.SendMicStop) { desktop.m.SendMicStop(); }
        teardown();
        setState('idle');
    };

    obj.toggle = function () {
        if (obj.state === 'live' || obj.state === 'requesting') { obj.stop(); } else { obj.start(); }
    };

    // ---------------------------------------------------------------------
    // Change the encoder settings profile (bitrate/bandwidth/etc, see the
    // Mic Settings dialog). Safe to call any time: if a session is already
    // live or requesting, re-applies immediately without interrupting audio
    // (the agent re-applies in place -- see mic_apply_params() in
    // linux_mic.c/windows_mic.c); otherwise just stored for the next start().
    // Pass null to fall back to the agent's own built-in default.
    // ---------------------------------------------------------------------
    obj.applySettings = function (params) {
        obj.params = params;
        if (obj.state === 'live' || obj.state === 'requesting') {
            if (desktop && desktop.m && desktop.m.SendMicStart) { desktop.m.SendMicStart(obj.params); }
        }
    };

    // ---------------------------------------------------------------------
    // MNG_MIC_DATA (99): [type 2][len 2][seq 2][flags 1][opus...]
    // Reordered and late packets are common on a relay, so buffer briefly and
    // play in sequence rather than decoding whatever arrives first.
    // ---------------------------------------------------------------------
    obj.onData = function (view) {
        if (obj.state !== 'live') { return; }

        var seq = (view[4] << 8) | view[5];
        var opus = view.slice(7);

        var inserted = false;
        for (var i = 0; i < jitter.length; i++) {
            if (seq < jitter[i].seq) { jitter.splice(i, 0, { seq: seq, opus: opus }); inserted = true; break; }
        }
        if (!inserted) { jitter.push({ seq: seq, opus: opus }); }

        drain();
    };

    function drain() {
        while (jitter.length > jitterDepth) {
            var pkt = jitter.shift();
            if (nextSeq >= 0 && pkt.seq !== (nextSeq & 0xFFFF)) { gapCount++; }
            nextSeq = (pkt.seq + 1) & 0xFFFF;

            if (decoder && decoder.state === 'configured') {
                try {
                    decoder.decode(new EncodedAudioChunk({
                        type: 'key',
                        timestamp: pkt.seq * 20000,   // 20 ms frames, in microseconds
                        data: pkt.opus
                    }));
                } catch (ex) { /* a bad frame should not end the stream */ }
            }
        }
    }

    // Grow the buffer when packets are being lost, shrink it when the link is
    // clean, so latency stays as low as the connection allows.
    function startGapTimer() {
        if (gapTimer) { return; }
        gapTimer = setInterval(function () {
            if (gapCount > 3) { jitterDepth = Math.min(jitterDepth + 1, JITTER_MAX); }
            else if (gapCount === 0 && jitterDepth > JITTER_MIN) { jitterDepth--; }
            gapCount = 0;
        }, 5000);
    }

    function beginPlayback() {
        if (actx != null) { return; }

        try {
            actx = new AudioContext({ sampleRate: SAMPLE_RATE });
        } catch (ex) {
            teardown();
            setState('idle', 'Could not open audio playback.');
            return;
        }

        actx.audioWorklet.addModule('scripts/agent-audio-worklet-0.1.0.js').then(function () {
            if (actx == null) { return; }   // stopped while loading

            worklet = new AudioWorkletNode(actx, 'mesh-audio-processor');
            worklet.connect(actx.destination);

            // Browsers start an AudioContext suspended unless it was created
            // inside a user gesture; without this there would be silence.
            actx.resume().catch(function () { });

            decoder = new AudioDecoder({
                output: function (audioData) {
                    var pcm = new Float32Array(audioData.numberOfFrames);
                    // Force f32-planar: some browsers decode to s16, which would
                    // be misread as float and play as noise.
                    audioData.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
                    audioData.close();

                    // Peak level, so the operator can see the far end is live
                    // even when nobody happens to be speaking.
                    var peak = 0;
                    for (var i = 0; i < pcm.length; i++) {
                        var v = pcm[i] < 0 ? -pcm[i] : pcm[i];
                        if (v > peak) { peak = v; }
                    }
                    obj.level = peak;

                    worklet.port.postMessage(pcm, [pcm.buffer]);
                },
                error: function (err) { console.log('MeshMic: decode error', err); }
            });

            decoder.configure({
                codec: 'opus',
                sampleRate: SAMPLE_RATE,
                numberOfChannels: (obj.caps && obj.caps.channels) ? obj.caps.channels : 1
            });

            jitter = [];
            nextSeq = -1;
            gapCount = 0;
            startGapTimer();
            startLevelMeter();
            setState('live', 'You can hear this device.');
        }).catch(function (ex) {
            console.log('MeshMic: worklet failed to load', ex);
            teardown();
            setState('idle', 'Could not start audio playback.');
        });
    }

    function startLevelMeter() {
        if (levelTimer) { return; }
        levelTimer = setInterval(function () {
            if (obj.onLevel) { try { obj.onLevel(obj.level); } catch (ex) { } }
            // Decay between frames so the meter falls back to rest during
            // silence instead of holding the last peak.
            obj.level *= 0.6;
        }, 100);
    }

    function teardown() {
        if (gapTimer) { clearInterval(gapTimer); gapTimer = null; }
        if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
        if (consentTimer) { clearTimeout(consentTimer); consentTimer = null; }
        if (decoder != null) { try { decoder.close(); } catch (ex) { } decoder = null; }
        if (worklet != null) { try { worklet.disconnect(); } catch (ex) { } worklet = null; }
        if (actx != null) { try { actx.close(); } catch (ex) { } actx = null; }
        jitter = [];
        nextSeq = -1;
        obj.level = 0;
        if (obj.onLevel) { try { obj.onLevel(0); } catch (ex) { } }
    }

    return obj;
};
