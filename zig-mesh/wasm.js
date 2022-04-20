function getString(inst, ptr, len) {
    const slice = deref(Uint8Array, inst, ptr, len);
    let arr = [];

    for (let i = 0; i < slice.length; i++) {
        const char = String.fromCharCode(slice[i]);
        arr.push(char);
    }

    return arr.join('');
}

function deref(T, inst, ptr, len) {
    return new T(inst.exports.memory.buffer, ptr, len);
}

class Mesh {

    static async init(config) {
        const mesh = new Mesh();
        const conf = Object.assign({
            width: 10,
            height: 10,
            spacing: 1,
            tension: 1,
        }, config);

        mesh.wasm = (await Mesh.loadWasm()).instance;
        mesh.wasm.exports.js_init(
            conf.width,
            conf.height,
            conf.spacing,
            conf.tension,
        );

        mesh.vertex_buffer_len = conf.width * conf.height * 3 * 2;
        mesh.vertex_buffer = mesh.wasm.exports.allocBuffer(mesh.vertex_buffer_len * Float32Array.BYTES_PER_ELEMENT);

        return mesh;
    }

    static async loadWasm() {
        const res = await fetch('./zig-mesh/zig-out/lib/zig-mesh.wasm');
        const wasm_buf = await res.arrayBuffer();
        const wasm = await WebAssembly.instantiate(wasm_buf, {
            debug: {
                js_log: (buf, len) => {
                    const str = getString(wasm.instance, buf, len);
                    console.log(str);
                },
                js_err: (buf, len) => {
                    const str = getString(wasm.instance, buf, len);
                    console.error(str);
                },
            },
        });

        return wasm;
    }

    excite(t, values, scale = 1.0) {
        const ptr = this.wasm.exports.allocBuffer(values.length * Float32Array.BYTES_PER_ELEMENT);
        const buf = deref(Float32Array, this.wasm, ptr, values.length);

        for (let i = 0; i < values.length; i++) {
            buf[i] = values[i] * scale;
        }

        this.wasm.exports.js_process(t, ptr, values.length);
    }

    getVertexBuffer() {
        this.wasm.exports.js_fillVertexBuffer(this.vertex_buffer, this.vertex_buffer_len);
        return deref(Float32Array, this.wasm, this.vertex_buffer, this.vertex_buffer_len);
    }

    setTension(tension) {
        this.wasm.exports.js_setTension(tension);
    }

    setIterations(iterations) {
        this.wasm.exports.js_setIterations(iterations);
    }

}
