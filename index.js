const regl = createREGL();
const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;

const w = 200;
const h = 200;

let input_counter = 0;

function makeSlider(config) {
    const input = document.createElement('input');
    const container = document.createElement('div');
    const label = document.createElement('label');

    let obj = {};

    input.setAttribute('id', `slider-${input_counter++}`);
    input.setAttribute('type', 'range');
    input.setAttribute('min', config.min);
    input.setAttribute('max', config.max);
    input.setAttribute('step', config.step);

    if ('initial' in config) {
        input.value = config.initial;
    }

    obj.value = parseFloat(input.value);

    input.addEventListener('input', () => {
        obj.value = parseFloat(input.value);
        label.innerText = `${config.name}: ${obj.value}`;
    });

    label.innerText = `${config.name}: ${obj.value}`;
    label.setAttribute('for', input.getAttribute('id'));

    container.classList.add('custom-input');
    container.appendChild(label);
    container.appendChild(input);

    return {
        data: obj,
        elem: container,
    };
}

const plate_points_raw = new Float32Array(w * h * 2);
const plate_elements = new Uint16Array((w - 1) * (h - 1) * 3 * 2);

for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
        const i = y * w + x;

        plate_points_raw[i * 2] = x - (w / 2);
        plate_points_raw[i * 2 + 1] = y - (h / 2);
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
    usage: 'static',
    data: plate_points_raw,
});

const drawMesh = regl({
    vert: `
        #define PI 3.141592653

        precision mediump float;

        attribute vec2 position;

        uniform mat4 camera, normal_mat, model_mat;
        uniform float n, m, L, t;

        varying vec3 vLighting;

        float chladni(vec2 pos) {
            float a = cos(n * PI * pos.x / L);
            float b = cos(m * PI * pos.y / L);

            float c = cos(m * PI * pos.x / L);
            float d = cos(n * PI * pos.y / L);

            return a * b - c * d;
        }

        vec3 chladniPoint(vec2 pos) {
            return vec3(pos.x, chladni(pos), pos.y);
        }

        void main() {
            vec3 p1 = (model_mat * vec4(chladniPoint(position), 1.0)).xyz;
            vec3 p2 = (model_mat * vec4(chladniPoint(position + vec2(1.0, 0.0)), 1.0)).xyz;
            vec3 p3 = (model_mat * vec4(chladniPoint(position + vec2(0.0, 1.0)), 1.0)).xyz;

            vec3 normal = cross(p3 - p1, p2 - p1);

            vec3 ambient_light = vec3(0.04);
            vec3 directional_light_color = vec3(0.3, 0.5, 1.0);
            vec3 directional_vector = vec3(0.85, 0.8, 0.0);

            vec4 transformed_normal = normal_mat * vec4(normal, 1.0);
            float directional = max(dot(transformed_normal.xyz, directional_vector), 0.0);

            vLighting = ambient_light + (directional_light_color * directional);

            gl_PointSize = 2.0;
            gl_Position = camera * vec4(p1, 1.0);
        }
    `,
    frag: `
        precision mediump float;

        varying vec3 vLighting;

        void main() {
            vec4 texel = vec4(1.0);
            gl_FragColor = vec4(texel.rgb * vLighting, 1.0);
        }
    `,
    attributes: {
        position: plate_buffer,
    },
    uniforms: {
        m: regl.prop('m'),
        n: regl.prop('n'),
        L: regl.prop('L'),
        t: regl.prop('t'),
        camera: regl.prop('camera'),
        model_mat: regl.prop('model'),
        normal_mat: (ctx, props) => mat4.transpose(mat4.create(), mat4.invert(mat4.create(), props.camera)),
    },
    depth: {
        enable: true,
        mask: true,
        func: 'less',
        range: [0, 1]
    },
    cull: {
        enable: false,
        face: 'front',
    },

    primitive: 'triangles',
    elements: plate_elements,
    count: plate_elements.length,
});

const control_container = document.querySelector('.controls');

const n_slider = makeSlider({
    name: 'n',
    min: 0,
    max: 5,
    initial: 2,
    step: 0.1,
});

const m_slider = makeSlider({
    name: 'm',
    min: 0,
    max: 5,
    initial: 1,
    step: 0.1,
});

const L_slider = makeSlider({
    name: 'L scale',
    min: 0.1,
    max: 3,
    initial: 0.5,
    step: 0.1,
});

const camera_pos = { x: 0, y: 0, z: -w * 2.2 };

control_container.appendChild(n_slider.elem);
control_container.appendChild(m_slider.elem);
control_container.appendChild(L_slider.elem);

regl.frame(ctx => {
    regl.clear({
        color: [0, 0, 0, 1],
    });

    let camera = mat4.perspective(
        mat4.create(),
        Math.PI / 4,
        ctx.viewportWidth / ctx.viewportHeight,
        100,
        w * 4,
    );

    mat4.translate(camera, camera, vec3.fromValues(camera_pos.x, camera_pos.y, camera_pos.z));
    mat4.rotate(camera, camera, Math.PI / 8, [1, 0, 0]);
    // mat4.rotate(camera, camera, ctx.time * 0.2, [0, 1, 0]);

    let model = mat4.create();
    mat4.translate(model, model, vec3.fromValues(0, 0, 0));
    mat4.scale(model, model, vec3.fromValues(1, 3, 1));
    mat4.rotate(model, model, ctx.time * 0.4, [0, 1, 0]);

    drawMesh({
        m: m_slider.data.value,
        n: n_slider.data.value,
        L: w * L_slider.data.value,
        t: ctx.time,
        camera: camera,
        model: model,
    });
});
