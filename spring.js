const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;
const regl = createREGL({
    extensions: ['OES_element_index_uint', 'ANGLE_instanced_arrays'],
});

const canvas = document.body.querySelector('canvas');

const audio_ctx = new AudioContext();
const music = new Audio();
let audio_processor;

const w = 101;
const h = 101;

const gui = new lil.GUI();
const settings = {
    particles: true,
    plate: false,
    particle_scale: 1,

    width: w,
    height: h,
    spacing: 1,
    constrain: 'edges',

    iterations: 1,
    tension: 1,
    sample_scale: 10,

    above: [0, 255, 0],
    below: [255, 0, 0],
    zero: [0, 0, 0],
    threshold: 0.1,
    background: [255, 255, 255],

    channel: 'left',
    mid_side: 0.0,

    save() {
        const saved = gui.save();
        localStorage.setItem('settings', JSON.stringify(saved));
    },

    load() {
        const raw = localStorage.getItem('settings');

        if (typeof raw !== 'string') {
            return;
        }


        try {
            const saved = JSON.parse(raw);
            gui.load(saved);
        } catch {
        }
    },

    resetMesh() {
        alert('This feature is not implemented');
    },

    uploadAudio() {
        selectFile('audio/*', files => {
            const file = files[0];

            if (music.src && !music.paused) {
                music.pause();
                window.URL.revokeObjectURL(music.src);
            }

            music.src = window.URL.createObjectURL(file);

            music.addEventListener('canplay', () => {
                music.play();
            }, { once: true });

            audio_ctx.resume();
        });
    }
};

const setup_settings = gui.addFolder('Initial Conditions');
setup_settings.add(settings, 'width', 2, 200).name('Width');
setup_settings.add(settings, 'height', 2, 200).name('Height');
setup_settings.add(settings, 'spacing', 0.1, 5).name('Particle Spacing');
setup_settings.add(settings, 'constrain').options(['edges', 'corners', 'none']).name('Constrain');
setup_settings.add(settings, 'resetMesh').name('Apply');

const constraint_settings = gui.addFolder('Constraints');
constraint_settings.add(settings, 'iterations', 1, 30, 1);
constraint_settings.add(settings, 'tension', Number.EPSILON, 2);
constraint_settings.add(settings, 'sample_scale', 0, 100);

const graphic_settings = gui.addFolder('Rendering');
graphic_settings.add(settings, 'particles').name('Draw Particles');
graphic_settings.add(settings, 'plate').name('Draw Plate');

graphic_settings.add(settings, 'particle_scale', 0.1, 10).name('Particle Scale');
graphic_settings.add(settings, 'threshold', 0, 1);
graphic_settings.addColor(settings, 'above', 255);
graphic_settings.addColor(settings, 'below', 255);
graphic_settings.addColor(settings, 'zero', 255);
graphic_settings.addColor(settings, 'background', 255);

const audio_settings = gui.addFolder('Audio');
audio_settings.add(settings, 'uploadAudio').name('Upload Audio');
audio_settings.add(settings, 'channel').name('Channel').options(['left', 'right', 'mid', 'side']);
audio_settings.add(settings, 'mid_side', -1, 1).name('Mid / Side');

gui.add(settings, 'save').name('Save Settings');
settings.load();

const overlay = document.body.querySelector('.overlay');
const overlay_settings = { mass: 0, force_vector: [0, 0, 0] };
const overlay_gui = new lil.GUI({ container: overlay });
overlay_gui.add(overlay_settings, 'mass', 0, 100).name('Inverse mass');
overlay_gui.addColor(overlay_settings, 'force_vector').name('Force Vector');

const mouse_position = {
    x: -1,
    y: -1,
};

const icosahedron = generateIcosahedron();
const plate_elements = new Uint32Array((w - 1) * (h - 1) * 3 * 2);
const particle_ids = new Float32Array(w * h * 4);
const picked_particles = new Float32Array(w * h);

for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
        // Hovering over "empty space" will return a vec4 of all zeroes, which
        // is why we need to offset our particle_idx by one.
        const particle_idx = (y * w + x) + 1;
        const idx = (y * w + x) * 4;

        particle_ids[idx + 0] = ((particle_idx >>  0) & 0xff) / 0xff;
        particle_ids[idx + 1] = ((particle_idx >>  8) & 0xff) / 0xff;
        particle_ids[idx + 2] = ((particle_idx >> 16) & 0xff) / 0xff;
        particle_ids[idx + 3] = ((particle_idx >> 24) & 0xff) / 0xff;
    }
}

for (let x = 0; x < w - 1; x++) {
    for (let y = 0; y < h - 1; y++) {
        const tri_idx = y * (w - 1) + x;

        const i = y * w + x;
        const ni = i + w;

        plate_elements[tri_idx * 3 * 2] = i;
        plate_elements[tri_idx * 3 * 2 + 1] = i + 1;
        plate_elements[tri_idx * 3 * 2 + 2] = ni;

        plate_elements[tri_idx * 3 * 2 + 3] = i + 1;
        plate_elements[tri_idx * 3 * 2 + 4] = ni + 1;
        plate_elements[tri_idx * 3 * 2 + 5] = ni;
    }
}

const plate_buffer = regl.buffer({
    usage: 'dynamic',
    type: 'float',
    size: Float32Array.BYTES_PER_ELEMENT * w * h * 3 * 2,
});

const plate_normal_buffer = regl.buffer({
    usage: 'dynamic',
    type: 'float',
    data: new Float32Array(w * h * 3),
});

const icosahedron_buffer = regl.buffer({
    usage: 'static',
    data: icosahedron.vertices,
    type: 'float',
});

const particle_id_buffer = regl.buffer({
    usage: 'static',
    data: particle_ids,
    type: 'float',
});

// Using an attribute buffer instead of a uniform for the picked particle
// allows us to easly add mass selections in the future.
const picked_particles_buffer = regl.buffer({
    usage: 'dynamic',
    data: picked_particles,
    type: 'float',
});

// I'm not sure which resolution to choose for the picking buffer.
// If we make it the same as the canvas it will need to be resized
// when drawing buffer dimensions change.
const picking_size = {
    width: 1024,
    height: 1024,
};
const picking_fbo = regl.framebuffer({
    color: [
        regl.texture({
            type: 'uint8',
            width: picking_size.width,
            height: picking_size.height,
        }),
    ],
});

const drawPlate = regl({
    vert: `
        precision highp float;

        attribute vec3 position, normal;

        uniform vec2 size;
        uniform mat4 camera, normal_mat;

        varying float z;
        varying vec3 vLighting;

        void main() {
            z = position.y;

            vec3 ambient_light = vec3(1.0);
            vec3 directional_light_color = vec3(0.5, 0.5, 0.75);
            vec3 directional_vector = vec3(0.8, 0.85, 0.75);

            vec4 transformed_normal = normal_mat * vec4(normal, 1.0);
            float directional = max(dot(transformed_normal.xzy, directional_vector), 0.0);

            vLighting = ambient_light + (directional_light_color * directional);

            gl_PointSize = 3.0;
            gl_Position = camera * vec4(position, 1.0);
        }
    `,
    frag: `
        precision mediump float;

        varying float z;
        varying vec3 vLighting;

        uniform vec3 above, below, zero;
        uniform float color_threshold;

        void main() {
            vec3 color = above;

            if (z > color_threshold) {
                color = above;
            } else if (z < -color_threshold) {
                color = below;
            }

            gl_FragColor = vec4(color * vLighting, 1.0);
        }
    `,
    attributes: {
        position: {
            buffer: plate_buffer,
            offset: 0,
            stride: Float32Array.BYTES_PER_ELEMENT * 3 * 2,
        },
        normal: {
            buffer: plate_buffer,
            offset: Float32Array.BYTES_PER_ELEMENT * 3,
            stride: Float32Array.BYTES_PER_ELEMENT * 3 * 2,
        },
    },
    uniforms: {
        camera: regl.prop('camera'),
        normal_mat: (ctx, props) => {
            let normal_mat = mat4.create();

            mat4.invert(normal_mat, props.camera);
            mat4.transpose(normal_mat, normal_mat);

            return normal_mat;
        },
        size: regl.prop('size'),
        above: () => settings.above.map(c => c / 255),
        below: () => settings.below.map(c => c / 255),
        zero: () => settings.zero.map(c => c / 255),
        color_threshold: () => settings.threshold,
    },

    depth: {
        enable: true,
    },
    cull: {
        enable: false,
        face: 'front',
    },

    elements: regl.elements({
        primitive: 'triangles',
        data: plate_elements,
        count: plate_elements.length,
    }),
});

const drawParticles = regl({
    vert: `
        precision mediump float;

        attribute vec3 particle_pos, vertex_pos;
        attribute float picked;

        uniform mat4 camera;
        uniform float particle_scale;

        varying vec3 pos;
        varying float v_picked;

        void main() {
            float scale = particle_scale + 1.0 * picked;
            vec3 position = vertex_pos * 0.1 * scale + particle_pos;
            pos = particle_pos;
            v_picked = picked;
            gl_Position = camera * vec4(position, 1.0);
        }
    `,
    frag: `
        precision mediump float;

        uniform vec3 above, below, zero;
        uniform float color_threshold;

        varying vec3 pos;
        varying float v_picked;

        void main() {
            vec3 color = zero;
            vec3 highlighted = vec3(1.0, 0.0, 0.0);

            float z = pos.y;

            if (z > color_threshold) {
                color = above;
            } else if (z < -color_threshold) {
                color = below;
            }

            vec3 final_color = mix(color, highlighted, v_picked);
            gl_FragColor = vec4(final_color, 1.0);
        }
    `,
    attributes: {
        picked: {
            buffer: picked_particles_buffer,
            offset: 0,
            stride: Float32Array.BYTES_PER_ELEMENT,
            divisor: 1,
        },
        particle_pos: {
            buffer: plate_buffer,
            offset: 0,
            stride: Float32Array.BYTES_PER_ELEMENT * 3 * 2,
            divisor: 1,
        },
        vertex_pos: icosahedron_buffer,
    },
    uniforms: {
        camera: regl.prop('camera'),
        size: regl.prop('size'),
        above: () => settings.above.map(c => c / 255),
        below: () => settings.below.map(c => c / 255),
        zero: () => settings.zero.map(c => c / 255),
        color_threshold: () => settings.threshold,
        particle_scale: () => settings.particle_scale,
    },

    depth: {
        enable: true,
    },
    cull: {
        enable: false,
        face: 'front',
    },

    instances: w * h,
    elements: regl.elements({
        primitive: 'triangles',
        data: icosahedron.indices,
        count: icosahedron.indices.length,
    }),
});

const drawParticlePicking = regl({
    vert: `
        precision mediump float;

        attribute vec3 particle_pos, vertex_pos;
        attribute vec4 particle_id;

        uniform mat4 camera;
        uniform float particle_scale;

        varying vec4 vparticle_id;

        void main() {
            vec3 position = vertex_pos * 0.1 * particle_scale + particle_pos;
            vparticle_id = particle_id;
            gl_Position = camera * vec4(position, 1.0);
        }
    `,
    frag: `
        precision mediump float;

        varying vec4 vparticle_id;

        void main() {
            gl_FragColor = vec4(vparticle_id);
        }
    `,
    attributes: {
        particle_id: {
            buffer: particle_id_buffer,
            offset: 0,
            stride: Float32Array.BYTES_PER_ELEMENT * 4,
            divisor: 1,
        },
        particle_pos: {
            buffer: plate_buffer,
            offset: 0,
            stride: Float32Array.BYTES_PER_ELEMENT * 3 * 2,
            divisor: 1,
        },
        vertex_pos: icosahedron_buffer,
    },
    uniforms: {
        camera: regl.prop('camera'),
        particle_scale: () => settings.particle_scale,
    },
    depth: {
        enable: true,
    },

    instances: w * h,
    elements: regl.elements({
        primitive: 'triangles',
        data: icosahedron.indices,
        count: icosahedron.indices.length,
    }),
});

window.addEventListener('click', () => {
    audio_ctx.audioWorklet.addModule('./processor.js').then(() => {
        audio_ctx.resume();

        if (music.paused) {
            const src = audio_ctx.createMediaElementSource(music);
            const processor = audio_processor = new AudioWorkletNode(audio_ctx, 'sample-grabber', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });

            music.play();

            processor.port.onmessage = msg => typeof onAudioBuffer === 'function' ? onAudioBuffer(msg.data) : undefined;

            src.connect(processor);
            processor.connect(audio_ctx.destination);
        }
    });
});

canvas.addEventListener('mousemove', e => {
    const x = e.pageX - e.target.offsetLeft;
    const y = e.pageY - e.target.offsetTop;

    mouse_position.x = x / e.target.clientWidth;
    mouse_position.y = y / e.target.clientHeight;
});

Mesh.init({
    width: w,
    height: h,
    spacing: settings.spacing,
    iterations: settings.iterations,
    tension: settings.tension
}).then(mesh => {
    let sample = 0;
    window.onAudioBuffer = samples => sample = samples[0];

    regl.frame(ctx => {
        let camera = mat4.perspective(
            mat4.create(),
            Math.PI / 4,
            ctx.viewportWidth / ctx.viewportHeight,
            0.01,
            200,
        );

        mat4.translate(camera, camera, vec3.fromValues(0, -0.1, -settings.spacing * w));
        mat4.rotate(camera, camera, 0.3, [1, 0, 0]);
        mat4.translate(camera, camera, vec3.fromValues(0, 0, 0));
        // mat4.rotate(camera, camera, ctx.time * 0.1, [0, 1, 0]);

        regl.clear({
            color: settings.background.map(c => c / 255).concat([1]),
            depth: true,
        });

        // Update these variables on every frame.
        mesh.setTension(settings.tension);
        mesh.setIterations(settings.iterations);

        if (audio_processor) {
            audio_processor.port.postMessage({
                channel: settings.channel,
                mid_side: settings.mid_side,
            });
        }

        mesh.excite(ctx.time, [sample], settings.sample_scale);
        plate_buffer(mesh.getVertexBuffer());

        if (settings.plate) {
            drawPlate({
                camera: camera,
                size: [w, h],
            });
        }

        if (settings.particles) {
            const picked = getParticleAtPos(camera, mouse_position);

            picked_particles.fill(0);
            picked_particles[picked] = 1.0;
            picked_particles_buffer(picked_particles);

            if (picked === undefined) {
                canvas.style.cursor = 'default';
                overlay.style.display = 'none';
            } else {
                canvas.style.cursor = 'pointer';
                overlay.style.display = 'block';

                setOverlayPosition({
                    x: mouse_position.x * canvas.clientWidth,
                    y: mouse_position.y * canvas.clientHeight,
                });
            }

            drawParticles({
                camera: camera,
                size: [w, h],
            });
        }
    });
});

function getParticleAtPos(camera, position) {
    if (position.x >= 0 && position.x < 1 && position.y >= 0 && position.y < 1) {
        let particle_id = 0;

        regl({
            framebuffer: picking_fbo,
        })(() => {
            regl.clear({
                depth: true,
                color: [0, 0, 0, 0],
            });

            drawParticlePicking({
                camera: camera,
            });

            const pixel = regl.read({
                x: Math.floor(position.x * picking_size.width),
                y: picking_size.height - Math.floor(position.y * picking_size.height) - 1,
                width: 1,
                height: 1,
            });

            particle_id = pixel[0] | (pixel[1] << 8) | (pixel[2] << 16) | (pixel[3] << 24);
        });

        return particle_id === 0 ? undefined : particle_id - 1;
    } else {
        return undefined;
    }
}

function generateIcosahedron() {
    let vertices = new Float32Array(12 * 3);

    vertices[0] = vertices[33] = 0;
    vertices[1] = vertices[34] = 0;
    vertices[2] = 1;
    vertices[35] = -1;

    for (let i = 0; i < 10; i++) {
        const progress = (i % 5) / 5;
        const idx = 3 + i * 3;
        const phase = Math.floor(i / 5) * Math.PI * 2 / 10;

        const phi = phase + progress * Math.PI * 2;
        const theta = Math.PI / 3 + Math.floor(i / 5) * Math.PI / 3;

        vertices[idx] = Math.sin(theta) * Math.cos(phi);
        vertices[idx + 2] = Math.sin(theta) * Math.sin(phi);
        vertices[idx + 1] = Math.cos(theta);
    }

    return {
        vertices,
        indices: new Uint16Array([
            0,  1,  2,
            0,  2,  3,
            0,  3,  4,
            0,  4,  5,
            0,  5,  1,

            5, 4, 9,
            5, 9, 10,
            4, 3, 8,
            4, 8, 9,
            3, 2, 7,
            3, 7, 8,
            6, 2, 1,
            2, 6, 7,

            1, 5, 10,
            6, 1, 10,

            11, 10, 9,
            11, 9,  8,
            11, 8,  7,
            11, 7,  6,
            11, 6, 10,
        ]),
    };

    return vertices;
}

function setOverlayPosition(position) {
    const computed = getComputedStyle(overlay);
    const width = computed.getPropertyValue('--width');
    const width_px = parseInt(width);

    const offset = {
        x: 10,
        y: 10,
    };

    const diff = {
        x: window.innerWidth - (position.x + width_px + offset.x),
        y: window.innerHeight - (position.y + 100 + offset.y),
    };

    if (diff.x < 0) {
        position.x += diff.x;
    }

    overlay.style.left = `${position.x + offset.x}px`;
    overlay.style.top = `${position.y + offset.y}px`;
}

function selectFile(accept, onchange) {
    const file_input = document.createElement('input');
    file_input.type = 'file';
    file_input.accept = accept;
    file_input.style.position = 'fixed';
    file_input.style.left = '-500px';
    file_input.style.top = '-500px';

    const removeInput = () => file_input.parentElement && file_input.parentElement.removeChild(file_input);
    file_input.onchange = () => {
        removeInput();
        onchange(file_input.files);
    };

    const old_on_focus = document.body.onfocus;
    document.body.onfocus = e => {
        removeInput();
        document.body.onfocus = old_on_focus;

        if (typeof old_on_focus === 'function')
            old_on_focus(e);
    };

    document.body.appendChild(file_input);
    file_input.click();
}
