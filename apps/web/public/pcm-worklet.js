// pcm-worklet.js
// Runs on the audio rendering thread. Captures mono float32 mic frames and
// posts them to the main thread, where they get converted to PCM16 + base64
// and streamed to the Grok Voice Agent API.

class PCMCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Copy the channel-0 samples; the underlying buffer is reused by the engine.
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true; // keep processor alive
  }
}

registerProcessor("pcm-capture-processor", PCMCaptureProcessor);
