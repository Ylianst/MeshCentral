/**
 * @description MeshCentral remote audio manager.
 *              Decodes Opus frames arriving over the KVM stream using the
 *              WebCodecs AudioDecoder API and drives an AudioWorklet ring
 *              buffer for low-latency playback.
 *
 *              Requires: Chrome 94+, Firefox 130+, Edge 94+
 *              Safari is not supported (no AudioDecoder for Opus).
 *
 * @version v0.1.0
 *
 * Usage:
 *   var deskAudio = CreateAgentAudio(desktop);
 *   // Called by agent-desktop when MNG_AUDIO_CAPS arrives:
 *   desktop.m.onAudioCaps = function(caps) { deskAudio.onCaps(caps); };
 *   desktop.m.onAudioData = function(view)  { deskAudio.onData(view); };
 *   deskAudio.start();   // sends MNG_AUDIO_START to agent
 *   deskAudio.stop();    // sends MNG_AUDIO_STOP  to agent
 */

'use strict';

var CreateAgentAudio = function (desktop) {
    var obj = {};
    obj.caps        = null;   // MNG_AUDIO_CAPS parsed object
    obj.active      = false;  // audio currently streaming
    obj._actx       = null;   // AudioContext
    obj._worklet    = null;   // AudioWorkletNode
    obj._decoder    = null;   // WebCodecs AudioDecoder
    obj._jitter     = [];     // seq-sorted packet queue
    obj._nextSeq    = -1;     // next expected sequence number
    obj._gapCount   = 0;      // gaps detected in last 5s window
    obj._jitterDepth = 3;     // adaptive target depth in packets (3 = 60ms at 20ms/pkt)
    obj._gapTimer   = null;
    obj._starting   = false;  // true while addModule() promise is pending

    var JITTER_MIN = 2;
    var JITTER_MAX = 8;

    // -----------------------------------------------------------------------
    // Called when MNG_AUDIO_CAPS (91) is received from the agent
    // -----------------------------------------------------------------------
    obj.onCaps = function (caps) {
        obj.caps = caps;
        console.log('MeshAudio: CAPS received', caps);
        // Show / hide the audio button in the UI based on capture_available
        var btn = Q('DeskAudioButton');
        if (btn) { QV('DeskAudioButton', caps.captureAvailable); }
    };

    // -----------------------------------------------------------------------
    // Called for every MNG_AUDIO_DATA (90) frame from the agent
    // Packet layout: [type 2B][total_len 2B][seq 2B][flags 1B][opus...]
    // The `view` Uint8Array starts at byte 0 of the full KVM packet.
    // -----------------------------------------------------------------------
    obj.onData = function (view) {
        if (!obj.active) return;
        var seq   = (view[4] << 8) | view[5];
        if (obj._jitter.length === 0 && obj._nextSeq === -1) {
            console.log('MeshAudio: first audio frame received, seq=', seq);
        }
        var flags = view[6];
        var opus  = view.slice(7); // Uint8Array of Opus payload

        // Insert into jitter buffer sorted by seq
        var inserted = false;
        for (var i = 0; i < obj._jitter.length; i++) {
            if (seq < obj._jitter[i].seq) {
                obj._jitter.splice(i, 0, { seq: seq, flags: flags, opus: opus });
                inserted = true;
                break;
            }
        }
        if (!inserted) obj._jitter.push({ seq: seq, flags: flags, opus: opus });

        // Drain jitter buffer when we have enough packets
        obj._drain();
    };

    obj._drain = function () {
        while (obj._jitter.length > obj._jitterDepth) {
            var pkt = obj._jitter.shift();

            // Gap detection for adaptive depth
            if (obj._nextSeq >= 0 && pkt.seq !== (obj._nextSeq & 0xFFFF)) {
                obj._gapCount++;
            }
            obj._nextSeq = (pkt.seq + 1) & 0xFFFF;

            // Decode and push to worklet
            if (obj._decoder && obj._decoder.state === 'configured') {
                var chunk = new EncodedAudioChunk({
                    type: 'key',
                    timestamp: pkt.seq * 20000, // 20ms per frame in µs
                    data: pkt.opus
                });
                obj._decoder.decode(chunk);
            }
        }
    };

    // Adaptive jitter buffer depth — checked every 5 seconds
    obj._startGapTimer = function () {
        obj._gapTimer = setInterval(function () {
            if (obj._gapCount > 3) {
                obj._jitterDepth = Math.min(obj._jitterDepth + 1, JITTER_MAX);
            } else if (obj._gapCount === 0 && obj._jitterDepth > JITTER_MIN) {
                obj._jitterDepth--;
            }
            obj._gapCount = 0;
        }, 5000);
    };

    // -----------------------------------------------------------------------
    // Start audio: set up AudioContext + AudioWorklet + WebCodecs decoder,
    // then send MNG_AUDIO_START to the agent.
    // -----------------------------------------------------------------------
    obj.start = function () {
        if (obj.active || obj._starting) return;
        console.log('MeshAudio: start() called, caps=', obj.caps, 'active=', obj.active);
        if (!window.AudioDecoder) {
            console.log('MeshAudio: WebCodecs AudioDecoder not available in this browser.');
            return;
        }
        if (!obj.caps || !obj.caps.captureAvailable) return;
        obj._starting = true;

        obj._actx = new AudioContext({ sampleRate: obj.caps.sampleRate });

        obj._actx.audioWorklet.addModule('scripts/agent-audio-worklet-0.1.0.js').then(function () {
            obj._worklet = new AudioWorkletNode(obj._actx, 'mesh-audio-processor');
            obj._worklet.connect(obj._actx.destination);

            // Resume AudioContext — required by browser autoplay policy (Chrome 66+, Firefox).
            // When AudioContext is created outside a user-gesture handler it starts
            // in "suspended" state and produces no audio until explicitly resumed.
            obj._actx.resume().then(function () {
                console.log('MeshAudio: AudioContext state after resume:', obj._actx.state);
            });

            obj._decoder = new AudioDecoder({
                output: function (audioData) {
                    obj._decodeCount = (obj._decodeCount || 0) + 1;
                    var pcm = new Float32Array(audioData.numberOfFrames);
                    // Force f32-planar output regardless of decoder's native format.
                    // Without this, Firefox/Safari may output s16 which misinterprets as float.
                    audioData.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
                    var fmt = audioData.format;
                    var nFrames = audioData.numberOfFrames;
                    audioData.close();
                    // Log first 3 decoded frames: format + max amplitude to diagnose silence vs playback issue
                    if (obj._decodeCount <= 3) {
                        var maxAmp = 0;
                        for (var i = 0; i < pcm.length; i++) { if (Math.abs(pcm[i]) > maxAmp) maxAmp = Math.abs(pcm[i]); }
                        console.log('MeshAudio: decoded frame #' + obj._decodeCount +
                                    ' fmt=' + fmt + ' frames=' + nFrames +
                                    ' maxAmp=' + maxAmp.toFixed(5) +
                                    (maxAmp < 0.001 ? ' (SILENCE — play audio on managed device)' : ' (has content)'));
                    }
                    obj._worklet.port.postMessage(pcm, [pcm.buffer]);
                },
                error: function (e) {
                    console.log('MeshAudio decode error:', e);
                }
            });

            obj._decoder.configure({
                codec: 'opus',
                sampleRate: obj.caps.sampleRate,
                numberOfChannels: obj.caps.channels
            });

            obj.active = true;
            obj._starting = false;
            obj._nextSeq = -1;
            obj._decodeCount = 0;
            obj._jitter  = [];
            obj._startGapTimer();

            // Tell agent to start sending audio
            if (desktop && desktop.m) { desktop.m.SendAudioStart(); }

            // Update button icon + active pulse animation
            var img = Q('DeskAudioButtonImage');
            if (img) { img.src = 'images/icon-audio-on.png'; }
            var btn = Q('DeskAudioButton');
            if (btn) { btn.classList.add('audio-active'); }
            // Same state, reflected on the always-visible quick-toggle tab
            // (see devQuickToggle() in default.handlebars), so it's visible
            // without opening the Desktop panel.
            var tabBtn = Q('MainDevAudio');
            if (tabBtn) { tabBtn.classList.add('audio-active'); }
        }).catch(function (e) {
            obj._starting = false;
            console.log('MeshAudio worklet load failed:', e);
        });
    };

    // -----------------------------------------------------------------------
    // Stop audio: send MNG_AUDIO_STOP, tear down decoder and AudioContext.
    // -----------------------------------------------------------------------
    obj.stop = function () {
        obj._starting = false;
        if (!obj.active) return;
        obj.active = false;

        if (obj._gapTimer) { clearInterval(obj._gapTimer); obj._gapTimer = null; }
        if (desktop && desktop.m) { desktop.m.SendAudioStop(); }

        if (obj._decoder) {
            try { obj._decoder.close(); } catch (e) {}
            obj._decoder = null;
        }
        if (obj._worklet) {
            obj._worklet.disconnect();
            obj._worklet = null;
        }
        if (obj._actx) {
            obj._actx.close();
            obj._actx = null;
        }
        obj._jitter  = [];
        obj._nextSeq = -1;

        // Update button icon + remove active pulse animation
        var img = Q('DeskAudioButtonImage');
        if (img) { img.src = 'images/icon-audio-off.png'; }
        var btn = Q('DeskAudioButton');
        if (btn) { btn.classList.remove('audio-active'); }
        var tabBtn = Q('MainDevAudio');
        if (tabBtn) { tabBtn.classList.remove('audio-active'); }
    };

    // Toggle (called by the toolbar button)
    obj.toggle = function () {
        if (obj.active) { obj.stop(); } else { obj.start(); }
    };

    return obj;
};
