/**
 * @description MeshCentral remote camera viewer.
 *
 *   Shows the managed device's webcam in the operator's browser, so an
 *   administrator can see whether someone is at the machine, what a described
 *   problem actually looks like, or whether a light or cable is where it is
 *   claimed to be.
 *
 *   This never touches the operator's own camera: video travels one way,
 *   device -> browser, exactly like the microphone in agent-mic-0.1.0.js.
 *
 *   The device's user is asked before their camera is opened, and the agent
 *   refuses to capture until they accept. This module only requests; it can
 *   never grant.
 *
 *   Frames arrive as complete JPEG images rather than a video codec -- see
 *   kvm_cam.h in the agent for why -- so decoding needs nothing beyond what
 *   every browser already does for ordinary images. No WebCodecs required.
 *
 * @version v0.1.0
 *
 * Usage:
 *   var deskCam = CreateAgentCamera(desktop);
 *   deskCam.setCanvas(Q('p23canvas'));
 *   desktop.m.onCamCaps       = function (caps)  { deskCam.onCaps(caps); };
 *   desktop.m.onCamData       = function (frame) { deskCam.onData(frame); };
 *   desktop.m.onCamSnapshot   = function (snap)  { deskCam.onSnapshot(snap); };
 *   desktop.m.onCamDeviceList = function (devs)  { deskCam.onDeviceList(devs); };
 *   deskCam.start();
 */

'use strict';

var CreateAgentCamera = function (desktop) {
    var obj = {};

    // 'unavailable'  device has no camera
    // 'idle'         ready, not streaming
    // 'requesting'   waiting for the device user to accept or refuse
    // 'live'         streaming
    obj.state = 'unavailable';
    obj.caps = null;
    obj.params = null;          // resolved capture settings, or null = agent default
    obj.devices = [];
    obj.lastSnapshot = null;

    obj.onStateChanged = null;  // function (state, detail)
    obj.onStats = null;         // function (stats)
    obj.onSnapshot = null;      // function (snapshot)
    obj.onDeviceListChanged = null; // function (devices)

    obj.stats = { frames: 0, bytes: 0, fps: 0, kbps: 0, width: 0, height: 0, passthrough: false };

    var canvas = null, ctx = null;
    var consentTimer = null, retryTimer = null, statsTimer = null;
    var windowFrames = 0, windowBytes = 0;
    var recvCount = 0, lastDrawnId = 0;
    var pendingSnapshotResolve = null;

    function setState(state, detail) {
        if (obj.state === state) { return; }
        obj.state = state;
        if (obj.onStateChanged) { try { obj.onStateChanged(state, detail); } catch (ex) { console.log(ex); } }
    }

    obj.setCanvas = function (el) {
        canvas = el;
        ctx = (canvas != null) ? canvas.getContext('2d') : null;
    };

    // ---------------------------------------------------------------------
    // MNG_CAM_CAPS (106)
    // ---------------------------------------------------------------------
    obj.onCaps = function (caps) {
        obj.caps = caps;
        obj.stats.passthrough = !!caps.passthrough;

        if (!caps.captureAvailable) {
            teardown();
            setState('unavailable');
            return;
        }

        if (caps.consentGranted) {
            if (consentTimer) { clearTimeout(consentTimer); consentTimer = null; }
            if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
            if (obj.state !== 'live') {
                startStats();
                setState('live', 'You can see this device.');
            }
        } else if (obj.state === 'live') {
            // Withdrawn mid-session, or the agent stopped capturing.
            teardown();
            setState('idle', 'Camera access ended.');
        } else if (obj.state !== 'requesting') {
            setState('idle');
        }
    };

    obj.onDeviceList = function (devices) {
        obj.devices = devices || [];
        if (obj.onDeviceListChanged) { try { obj.onDeviceListChanged(obj.devices); } catch (ex) { } }
    };

    obj.queryDevices = function () {
        if (desktop && desktop.m && desktop.m.SendCamDeviceQuery) { desktop.m.SendCamDeviceQuery(); }
    };

    obj.query = function () {
        if (desktop && desktop.m && desktop.m.SendCamQuery) { desktop.m.SendCamQuery(); }
    };

    // The agent reports an explicit refusal.
    obj.onConsentDenied = function () {
        if (consentTimer) { clearTimeout(consentTimer); consentTimer = null; }
        if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
        teardown();
        setState('idle', 'The user declined the camera request.');
    };

    // ---------------------------------------------------------------------
    // Starting / stopping
    // ---------------------------------------------------------------------
    function sendStart(skipConsentPrompt) {
        if (desktop && desktop.m && desktop.m.SendCamStart) {
            var p = obj.params ? Object.assign({}, obj.params) : {};
            p.skipConsentPrompt = !!skipConsentPrompt;
            desktop.m.SendCamStart(p);
        }
    }

    obj.start = function (skipConsentPrompt) {
        if (obj.state === 'live' || obj.state === 'requesting') { return; }
        if (!obj.caps || !obj.caps.captureAvailable) { setState('unavailable', 'This device has no camera.'); return; }

        setState('requesting', 'Asking the user for permission to use their camera...');
        sendStart(skipConsentPrompt);

        // The request crosses several async hops before an answer can come
        // back (the agent's master/slave pipe, then the server relay), any one
        // of which can lose a one-shot signal and leave this stuck in
        // 'requesting' until the operator reconnects by hand. Re-sending is
        // safe in every state the system can be in: once consent is granted a
        // repeat MNG_CAM_START with unchanged settings is an explicit no-op
        // fast path in native, and while a real prompt is still on screen the
        // agent's micConsentPending-equivalent guard drops the duplicate
        // before it could stack a second dialog. So this can only ever
        // shorten a stall. (Same fix as agent-mic-0.1.0.js.)
        retryTimer = setInterval(function () {
            if (obj.state !== 'requesting') { clearInterval(retryTimer); retryTimer = null; return; }
            sendStart(skipConsentPrompt);
        }, 3000);

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
        if (desktop && desktop.m && desktop.m.SendCamStop) { desktop.m.SendCamStop(); }
        teardown();
        setState('idle');
    };

    obj.toggle = function () {
        if (obj.state === 'live' || obj.state === 'requesting') { obj.stop(); } else { obj.start(); }
    };

    // Change capture settings. Safe any time: if a session is live the agent
    // applies what it can in place and restarts capture only for the settings
    // that genuinely require it (resolution, frame rate, device); otherwise
    // this is just stored for the next start().
    obj.applySettings = function (params) {
        obj.params = params;
        if (obj.state === 'live' || obj.state === 'requesting') { sendStart(false); }
    };

    // ---------------------------------------------------------------------
    // MNG_CAM_DATA (109): one complete JPEG frame
    // ---------------------------------------------------------------------
    obj.onData = function (frame) {
        if (obj.state !== 'live' && obj.state !== 'requesting') { return; }
        if (!frame || !frame.jpeg || frame.jpeg.length === 0) { return; }

        obj.stats.frames++;
        obj.stats.bytes += frame.jpeg.length;
        windowFrames++;
        windowBytes += frame.jpeg.length;
        obj.stats.passthrough = !!frame.passthrough;

        drawJpeg(frame.jpeg);
    };

    // Decoding is asynchronous, so two frames can be in flight at once and
    // resolve out of order. Tag each on arrival with a monotonically
    // increasing id and refuse to draw one older than what is already on
    // screen -- otherwise a slow-decoding frame could overwrite a newer one
    // and the picture would visibly stutter backwards. A wire sequence number
    // is deliberately not used for this: it wraps at 16 bits.
    function drawJpeg(bytes) {
        var myId = ++recvCount;
        var blob;
        try { blob = new Blob([bytes], { type: 'image/jpeg' }); } catch (ex) { return; }

        if (typeof createImageBitmap === 'function') {
            createImageBitmap(blob).then(function (bmp) {
                if (myId > lastDrawnId) { lastDrawnId = myId; paint(bmp, bmp.width, bmp.height); }
                if (bmp.close) { bmp.close(); }
            }).catch(function () { /* a corrupt frame must not end the stream */ });
        } else {
            var url = URL.createObjectURL(blob);
            var img = new Image();
            img.onload = function () {
                if (myId > lastDrawnId) { lastDrawnId = myId; paint(img, img.naturalWidth, img.naturalHeight); }
                URL.revokeObjectURL(url);
            };
            img.onerror = function () { URL.revokeObjectURL(url); };
            img.src = url;
        }
    }

    function paint(src, w, h) {
        if (ctx == null || canvas == null || !w || !h) { return; }
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        obj.stats.width = w;
        obj.stats.height = h;
        try { ctx.drawImage(src, 0, 0, w, h); } catch (ex) { }
    }

    // ---------------------------------------------------------------------
    // Snapshots
    // ---------------------------------------------------------------------
    obj.takeSnapshot = function (params) {
        if (desktop && desktop.m && desktop.m.SendCamSnapshot) {
            var p = params ? Object.assign({}, params) : {};
            // A snapshot from the Camera panel listens quietly for the same
            // reason the stream does; the caller decides.
            desktop.m.SendCamSnapshot(p);
            return true;
        }
        return false;
    };

    // MNG_CAM_SNAPSHOT_DATA (116)
    obj.onSnapshotData = function (snap) {
        if (!snap || !snap.jpeg || snap.jpeg.length === 0) { return; }

        var blob;
        try { blob = new Blob([snap.jpeg], { type: 'image/jpeg' }); } catch (ex) { return; }

        var record = {
            width: snap.width,
            height: snap.height,
            // The agent sends UTC seconds; keep both the raw value and a Date
            // so callers can format in the operator's own locale without
            // re-deriving it.
            takenAtUnix: snap.takenAt,
            takenAt: new Date(snap.takenAt * 1000),
            receivedAt: new Date(),
            captureMs: snap.captureMs,
            passthrough: !!snap.passthrough,
            bytes: snap.jpeg.length,
            format: 'JPEG',
            blob: blob,
            url: URL.createObjectURL(blob)
        };

        // Only one preview URL is held at a time; releasing the previous one
        // matters because these are full-resolution images and the browser
        // will not collect them while an object URL still refers to them.
        if (obj.lastSnapshot && obj.lastSnapshot.url) {
            try { URL.revokeObjectURL(obj.lastSnapshot.url); } catch (ex) { }
        }
        obj.lastSnapshot = record;

        if (pendingSnapshotResolve) { var r = pendingSnapshotResolve; pendingSnapshotResolve = null; try { r(record); } catch (ex) { } }
        if (obj.onSnapshot) { try { obj.onSnapshot(record); } catch (ex) { console.log(ex); } }
    };

    // Which save formats this browser can actually produce. JPEG and PNG are
    // universal; WebP is near-universal but still worth feature-detecting
    // rather than assuming, and anything unsupported silently falls back to
    // PNG in toDataURL, which would otherwise save a mislabelled file.
    obj.supportedSaveFormats = function () {
        var list = [{ id: 'jpeg', mime: 'image/jpeg', ext: 'jpg', label: 'JPEG (original, no re-encode)' },
                    { id: 'png', mime: 'image/png', ext: 'png', label: 'PNG (lossless)' }];
        try {
            var c = document.createElement('canvas');
            c.width = c.height = 1;
            if (c.toDataURL('image/webp').indexOf('data:image/webp') === 0) {
                list.push({ id: 'webp', mime: 'image/webp', ext: 'webp', label: 'WebP (smaller, lossy)' });
                list.push({ id: 'webp-lossless', mime: 'image/webp', ext: 'webp', label: 'WebP (lossless)' });
            }
        } catch (ex) { }
        return list;
    };

    /*
     * Save a snapshot to the operator's machine.
     *
     * 'jpeg' hands back exactly the bytes the device sent, with no re-encode
     * at all -- which for an MJPEG-passthrough capture means the operator
     * saves precisely what the camera's sensor produced. Every other format
     * is re-encoded here in the browser via canvas, so the managed device
     * never spends CPU producing alternative formats and no extra image
     * library has to be shipped to the agent.
     */
    obj.saveSnapshot = function (snap, formatId, filenameBase, quality) {
        snap = snap || obj.lastSnapshot;
        if (!snap) { return false; }

        var fmts = obj.supportedSaveFormats(), fmt = null, i;
        for (i = 0; i < fmts.length; i++) { if (fmts[i].id === formatId) { fmt = fmts[i]; break; } }
        if (fmt == null) { fmt = fmts[0]; }

        var base = filenameBase || ('camera-' + isoStamp(snap.takenAt));

        if (fmt.id === 'jpeg') { triggerDownload(snap.blob, base + '.jpg'); return true; }

        var img = new Image();
        var url = URL.createObjectURL(snap.blob);
        img.onload = function () {
            try {
                var c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                // Lossless WebP is requested by passing quality 1 to a
                // toBlob that treats 1 as "no loss"; ordinary WebP/JPEG use
                // the supplied quality.
                var q = (fmt.id === 'webp-lossless') ? 1 : ((typeof quality === 'number') ? quality : 0.92);
                c.toBlob(function (out) {
                    if (out) { triggerDownload(out, base + '.' + fmt.ext); }
                    URL.revokeObjectURL(url);
                }, fmt.mime, q);
            } catch (ex) { URL.revokeObjectURL(url); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); };
        img.src = url;
        return true;
    };

    function isoStamp(d) {
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
               p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    function triggerDownload(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoking immediately can cancel the download in some browsers, so
        // give the click a moment to be picked up first.
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (ex) { } }, 30000);
    }

    // ---------------------------------------------------------------------
    // Stats
    // ---------------------------------------------------------------------
    function startStats() {
        if (statsTimer) { return; }
        windowFrames = 0; windowBytes = 0;
        statsTimer = setInterval(function () {
            obj.stats.fps = windowFrames;
            obj.stats.kbps = Math.round((windowBytes * 8) / 1000);
            windowFrames = 0; windowBytes = 0;
            if (obj.onStats) { try { obj.onStats(obj.stats); } catch (ex) { } }
        }, 1000);
    }

    function teardown() {
        if (consentTimer) { clearTimeout(consentTimer); consentTimer = null; }
        if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
        if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
        obj.stats.fps = 0;
        obj.stats.kbps = 0;
        windowFrames = 0; windowBytes = 0;
        lastDrawnId = recvCount;
        if (obj.onStats) { try { obj.onStats(obj.stats); } catch (ex) { } }
    }

    // Release the preview URL held for the last snapshot. Called when the
    // whole session goes away, so a long-lived page does not retain a
    // full-resolution image indefinitely.
    obj.dispose = function () {
        teardown();
        if (obj.lastSnapshot && obj.lastSnapshot.url) {
            try { URL.revokeObjectURL(obj.lastSnapshot.url); } catch (ex) { }
        }
        obj.lastSnapshot = null;
    };

    return obj;
};
