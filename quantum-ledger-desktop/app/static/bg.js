// Command-centre backdrop: a slow 3D particle network drawn with raw WebGL.
// Local file, no libraries, no network. Falls back to the CSS gradient if WebGL is unavailable.
'use strict';

(() => {
  const canvas = document.getElementById('bg');
  const gl = canvas && canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
  if (!gl) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CYAN = [0.13, 0.83, 0.93];
  const PURPLE = [0.55, 0.36, 0.96];
  const LINK = 0.72; // max distance (scene units) for a connection
  const FPS = 30; // it's a backdrop: half frame rate is plenty

  // ── shaders ────────────────────────────────────────────────────────────────
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
  };

  const lineProg = program(
    `attribute vec2 a_pos; attribute vec4 a_col; varying vec4 v_col;
     void main() { v_col = a_col; gl_Position = vec4(a_pos, 0.0, 1.0); }`,
    `precision mediump float; varying vec4 v_col;
     void main() { gl_FragColor = vec4(v_col.rgb * v_col.a, v_col.a); }`,
  );
  const pointProg = program(
    `attribute vec2 a_pos; attribute vec4 a_col; attribute float a_size; varying vec4 v_col;
     void main() { v_col = a_col; gl_PointSize = a_size; gl_Position = vec4(a_pos, 0.0, 1.0); }`,
    `precision mediump float; varying vec4 v_col;
     void main() {
       float d = length(gl_PointCoord - 0.5);
       float core = smoothstep(0.5, 0.0, d);
       float a = v_col.a * core * core;
       gl_FragColor = vec4(v_col.rgb * a, a);
     }`,
  );
  if (!lineProg || !pointProg) return;

  const buf = { line: gl.createBuffer(), point: gl.createBuffer() };
  const loc = (p, name) => gl.getAttribLocation(p, name);

  // ── scene ──────────────────────────────────────────────────────────────────
  const rand = (a, b) => a + Math.random() * (b - a);
  let nodes = [];
  let stars = [];
  let pulses = [];

  function build() {
    const small = innerWidth * innerHeight < 900 * 700;
    const n = small ? 100 : 180;
    nodes = Array.from({ length: n }, (_, i) => ({
      x: rand(-2.7, 2.7), y: rand(-1.35, 1.35), z: rand(-1.1, 1.1),
      vx: rand(-1, 1) * 0.02, vy: rand(-1, 1) * 0.02, vz: rand(-1, 1) * 0.02,
      hue: Math.random() < 0.72 ? 0 : 1, // mostly cyan, some purple
      phase: Math.random() * Math.PI * 2,
      id: i,
    }));
    stars = Array.from({ length: small ? 160 : 280 }, () => ({ x: rand(-1, 1), y: rand(-1, 1), a: rand(0.08, 0.35), s: rand(0.6, 1.6) }));
    pulses = [];
  }

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(1.5, devicePixelRatio || 1);
    W = canvas.width = Math.round(innerWidth * dpr);
    H = canvas.height = Math.round(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    gl.viewport(0, 0, W, H);
  }

  // Rotate, then perspective-project into clip space.
  function project(p, rotY, rotX) {
    const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX);
    const x1 = p.x * cy + p.z * sy;
    const z1 = -p.x * sy + p.z * cy;
    const y1 = p.y * cx - z1 * sx;
    const z2 = p.y * sx + z1 * cx;
    const depth = z2 + 3.1; // camera distance
    const f = 2.2 / depth;
    return { x: (x1 * f) / (W / H), y: y1 * f, depth, near: 1 - (depth - 2) / 2.4 };
  }

  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  const stats = (window.__qlBackdrop = { frames: 0 });

  function frame(t, dt) {
    stats.frames++;
    // drift + soft bounds
    for (const p of nodes) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (Math.abs(p.x) > 2.8) p.vx *= -1;
      if (Math.abs(p.y) > 1.45) p.vy *= -1;
      if (Math.abs(p.z) > 1.2) p.vz *= -1;
    }
    const rotY = Math.sin(t * 0.03) * 0.55;
    const rotX = 0.28 + Math.sin(t * 0.05) * 0.06;
    const proj = nodes.map((p) => project(p, rotY, rotX));

    // connections
    const lines = [];
    const edges = [];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > LINK * LINK) continue;
        const k = 1 - Math.sqrt(d2) / LINK;
        const depthFade = Math.max(0.15, Math.min(1, (proj[i].near + proj[j].near) / 2));
        const alpha = k * 0.55 * depthFade;
        const c = mix(CYAN, PURPLE, (a.hue + b.hue) / 2);
        lines.push(proj[i].x, proj[i].y, c[0], c[1], c[2], alpha, proj[j].x, proj[j].y, c[0], c[1], c[2], alpha);
        edges.push([i, j]);
      }
    }

    // occasional data pulses travelling along edges
    if (!reduced && edges.length && pulses.length < 7 && Math.random() < dt * 2.2) {
      const [i, j] = edges[(Math.random() * edges.length) | 0];
      pulses.push({ i, j, t: 0, speed: rand(0.5, 0.9) });
    }
    pulses = pulses.filter((p) => (p.t += dt * p.speed) < 1);

    // points: stars (screen space), nodes, pulses
    const pts = [];
    for (const s of stars) pts.push(s.x, s.y, 0.75, 0.8, 1, s.a, s.s * dpr);
    for (let i = 0; i < nodes.length; i++) {
      const p = proj[i];
      const n = nodes[i];
      const twinkle = 0.75 + 0.25 * Math.sin(t * 1.3 + n.phase);
      const c = n.hue ? PURPLE : CYAN;
      const near = Math.max(0.2, Math.min(1, p.near));
      pts.push(p.x, p.y, c[0], c[1], c[2], 0.28 * near * twinkle, (10 + 14 * near) * dpr); // halo
      pts.push(p.x, p.y, c[0], c[1], c[2], 0.95 * near * twinkle, (3 + 5 * near) * dpr); // core
    }
    for (const pu of pulses) {
      const a = proj[pu.i], b = proj[pu.j];
      const x = a.x + (b.x - a.x) * pu.t, y = a.y + (b.y - a.y) * pu.t;
      const fade = Math.sin(pu.t * Math.PI);
      pts.push(x, y, 0.75, 0.97, 1, fade * 0.35, 26 * dpr);
      pts.push(x, y, 0.85, 1, 1, fade, 8 * dpr);
    }

    // draw
    gl.clearColor(0.012, 0.02, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive glow

    gl.useProgram(lineProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.line);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
    let pos = loc(lineProg, 'a_pos'), col = loc(lineProg, 'a_col');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(col);
    gl.vertexAttribPointer(col, 4, gl.FLOAT, false, 24, 8);
    gl.drawArrays(gl.LINES, 0, lines.length / 6);

    gl.useProgram(pointProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.point);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
    pos = loc(pointProg, 'a_pos');
    col = loc(pointProg, 'a_col');
    const size = loc(pointProg, 'a_size');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(col);
    gl.vertexAttribPointer(col, 4, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(size);
    gl.vertexAttribPointer(size, 1, gl.FLOAT, false, 28, 24);
    gl.drawArrays(gl.POINTS, 0, pts.length / 7);
  }

  // ── loop ───────────────────────────────────────────────────────────────────
  resize();
  build();
  frame(0, 0); // paint immediately, even if the page is not animating yet
  addEventListener('resize', () => {
    resize();
    build();
  });

  let last = performance.now();
  let acc = 0;
  let t = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    if (acc >= 1 / FPS) {
      t += reduced ? 0 : acc;
      frame(t, reduced ? 0 : acc);
      acc = 0;
    }
    if (!reduced) requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !reduced) {
      last = performance.now();
      requestAnimationFrame(loop);
    }
  });
  requestAnimationFrame(loop);
  canvas.classList.add('ready');
})();
