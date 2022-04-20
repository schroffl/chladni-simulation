class SampleGrabber extends AudioWorkletProcessor {

    constructor() {
        super();
        this.input_idx = 0;
        this.channel = 'left';
        this.mid_side = 0.0;

        this.mid_buffer = new Float32Array(128);
        this.side_buffer = new Float32Array(128);

        this.port.onmessage = e => {
            this.channel = e.data.channel;
            this.mid_side = e.data.mid_side;
        };
    }

    onmessage(e) {
    }

    process(inputs, outputs, parameters) {
        const in_idx = Math.min(this.input_idx, inputs.length - 1);
        const input = inputs[in_idx];
        const output = outputs[0];

        let buffer = undefined;

        if (input.length === 1) {
            output[0].set(input[0]);
            output[1].set(input[0]);
            buffer = input[0];
        } else if (input.length === 2) {
            buffer = this.mixStereo(input[0], input[1]);
            output[0].set(input[0]);
            output[1].set(input[1]);
        }

        this.port.postMessage(buffer);

        return true;
    }

    mixStereo(left, right) {
        for (let i = 0; i < left.length; i++) {
            const l = left[i];
            const r = right[i];

            let m = (l + r);
            let s = (l - r);

            const factor = this.mid_side * 0.5 + 0.5;
            m *= 1 - factor;
            s *= factor;

            this.mid_buffer[i] = m;
            this.side_buffer[i] = s;

            left[i] = (m + s);
            right[i] = (m - s);
        }

        if (this.channel === 'left') {
            return left;
        } else if (this.channel === 'right') {
            return right;
        } else if (this.channel === 'mid') {
            return this.mid_buffer;
        } else if (this.channel === 'side') {
            return this.side_buffer;
        }
    }

}

registerProcessor('sample-grabber', SampleGrabber);
