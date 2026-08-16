/**
 * @description MeshCentral microphone capture worklet.
 *
 *   Runs on the audio rendering thread and repackages the browser's native
 *   128-sample render quanta into the fixed 960-sample (20 ms at 48 kHz)
 *   frames the Opus encoder requires. Doing this here rather than on the main
 *   thread keeps capture steady while the page is busy.
 *
 *   It also computes a peak level per frame so the operator can see, rather
 *   than assume, that their microphone is live.
 *
 * @version v0.1.0
 */

'use strict';

var FRAME_SAMPLES = 960;   // 20 ms at 48 kHz, matching the encoder

class MeshMicProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = new Float32Array(FRAME_SAMPLES);
        this._fill = 0;
    }

    process(inputs) {
        var input = inputs[0];
        // No input connected yet, or the track ended. Staying alive means
        // capture resumes cleanly if the source reconnects.
        if (!input || input.length === 0) { return true; }

        var channel = input[0];
        if (!channel) { return true; }

        for (var i = 0; i < channel.length; i++) {
            this._buffer[this._fill++] = channel[i];

            if (this._fill === FRAME_SAMPLES) {
                var frame = new Float32Array(this._buffer);

                // Peak rather than RMS: a meter should react immediately to
                // speech so the operator can confirm they are being picked up.
                var peak = 0;
                for (var j = 0; j < FRAME_SAMPLES; j++) {
                    var v = frame[j] < 0 ? -frame[j] : frame[j];
                    if (v > peak) { peak = v; }
                }
                // Send the level as a separate field: a property set on a
                // TypedArray does not survive structured cloning, so attaching
                // it to the array itself would silently arrive as undefined.
                this.port.postMessage({ pcm: frame, level: peak }, [frame.buffer]);
                this._fill = 0;
            }
        }
        return true;
    }
}

registerProcessor('mesh-mic-processor', MeshMicProcessor);
