class AudioProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const channelData = input[0];
            // Send the raw Float32Array to the main thread
            // We clone it implicitly or can use transferables if needed, 
            // but for simple capture, this is standard.
            this.port.postMessage(channelData);
        }
        return true; // Keep the processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
