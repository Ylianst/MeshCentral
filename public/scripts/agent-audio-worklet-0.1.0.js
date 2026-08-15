/**
 * @description AudioWorklet processor for MeshCentral remote audio streaming.
 *              Maintains a ring buffer fed by decoded PCM from the main thread
 *              and outputs to the speaker every 128-sample render quantum.
 * @version v0.1.0
 */

'use strict';

const RING_SAMPLES = 48000 * 2; // 2-second Float32 ring buffer at 48 kHz

class MeshAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // Single-channel ring buffer
        this._ring = new Float32Array(RING_SAMPLES);
        this._writePos = 0;
        this._readPos  = 0;
        this._fill     = 0;  // samples currently in buffer

        this.port.onmessage = (e) => {
            // e.data is a Float32Array of decoded PCM samples (mono)
            const pcm = e.data;
            const len = pcm.length;
            if (len > RING_SAMPLES) return; // safety

            for (let i = 0; i < len; i++) {
                this._ring[this._writePos] = pcm[i];
                this._writePos = (this._writePos + 1) % RING_SAMPLES;
            }
            this._fill = Math.min(this._fill + len, RING_SAMPLES);
        };
    }

    process(inputs, outputs) {
        const out = outputs[0][0]; // mono output channel
        const n   = out.length;    // 128 samples per render quantum

        if (this._fill >= n) {
            for (let i = 0; i < n; i++) {
                out[i] = this._ring[this._readPos];
                this._readPos = (this._readPos + 1) % RING_SAMPLES;
            }
            this._fill -= n;
        } else {
            // Underrun: output silence (PLC handled upstream by Opus decoder)
            out.fill(0);
        }
        return true; // keep processor alive
    }
}

registerProcessor('mesh-audio-processor', MeshAudioProcessor);
