class AudioProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const channelData = input[0];
            // CRITICAL: We must copy the data here because the input buffer is 
            // reused by the browser for the next process() call.
            this.port.postMessage(new Float32Array(channelData));
        }
        return true; // Keep the processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
