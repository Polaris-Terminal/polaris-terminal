// Hero scene: a chrome Polaris star that stays fixed while the whole sky turns around it,
// the way the real sky turns around the pole star. Drag to spin it, click to send a ping.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const TAU = Math.PI * 2;

// Faceted four-point star: every half-arm is a strip between a raised centre ridge and a concave edge,
// which gives the light/dark split along each arm that the logo has.
function starGeometry({ len = 1, side = 0.86, valley = 0.13, height = 0.26, depth = 0.08, seg = 28 } = {}) {
  const pos = [];
  const tips = [[0, len], [side, 0], [0, -len], [-side, 0]];
  const cubic = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return p0.map((_, i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
  };
  const edge = (tip, vAng, t) => {
    // concave curve from a tip to the valley between two arms
    const v = [Math.cos(vAng) * valley, Math.sin(vAng) * valley];
    const dir = Math.hypot(...tip);
    const tn = [tip[0] / dir, tip[1] / dir];
    const c1 = [tip[0] * 0.55 + v[0] * 0.08, tip[1] * 0.55 + v[1] * 0.08];
    const c2 = [tn[0] * 0.2 + v[0] * 0.7, tn[1] * 0.2 + v[1] * 0.7];
    return cubic(tip, c1, c2, v, t);
  };
  const ridgeZ = (t, sign) => sign * (t < 1 ? height * Math.pow(t, 1.6) : height);
  for (const sign of [1, -1]) {
    const h = sign > 0 ? 1 : depth / 0.26;
    for (let k = 0; k < 4; k++) {
      const tip = tips[k];
      const tipAng = Math.atan2(tip[1], tip[0]);
      for (const side of [-1, 1]) {
        const vAng = tipAng + side * Math.PI / 4;
        for (let i = 0; i < seg; i++) {
          const a = i / seg, b = (i + 1) / seg;
          const r0 = [tip[0] * (1 - a), tip[1] * (1 - a), ridgeZ(a, sign) * h];
          const r1 = [tip[0] * (1 - b), tip[1] * (1 - b), ridgeZ(b, sign) * h];
          const e0 = [...edge(tip, vAng, a), 0];
          const e1 = [...edge(tip, vAng, b), 0];
          // keep winding outward on both faces
          const flip = (side > 0) !== (sign < 0);
          const quad = flip ? [r0, e0, e1, r0, e1, r1] : [r0, e1, e0, r0, r1, e1];
          for (const p of quad) pos.push(...p);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function arcGeometry(r, w, a0, a1) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r + w / 2, a0, a1, false);
  s.absarc(0, 0, r - w / 2, a1, a0, true);
  return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.012, bevelSegments: 3, curveSegments: 48 });
}

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.85)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function mountStar(canvas, { onPing } = {}) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 6.2);

  // lights: a cool key, and a green bounce from the logo's field
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const bounce = new THREE.PointLight(0x2fbf6b, 9, 12, 1.6);
  bounce.position.set(2.5, -2, 2.5);
  scene.add(bounce);

  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xe4ebe7, metalness: 1, roughness: 0.14, clearcoat: 0.5, clearcoatRoughness: 0.08, envMapIntensity: 1.25 });
  const rig = new THREE.Group();
  const star = new THREE.Mesh(starGeometry(), chrome);
  rig.add(star);
  const arcs = new THREE.Group();
  const gap = 0.36;
  for (let q = 0; q < 4; q++) {
    const a0 = q * Math.PI / 2 + gap, a1 = (q + 1) * Math.PI / 2 - gap;
    const m = new THREE.Mesh(arcGeometry(0.66, 0.045, a0, a1), chrome);
    m.position.z = -0.025;
    arcs.add(m);
  }
  rig.add(arcs);
  scene.add(rig);

  // sky: stars on a disc behind the pole, turning slowly; mint points are tokens in the drift
  const tex = dotTexture();
  const makeSky = (n, rMin, rMax, size, palette) => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const r = rMin + Math.pow(Math.random(), 0.7) * (rMax - rMin), a = Math.random() * TAU;
      p.set([Math.cos(a) * r, Math.sin(a) * r, -2 - Math.random() * 6], i * 3);
      c.set(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.55 + Math.random() * 0.45);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    return new THREE.Points(g, mat);
  };
  const sky = new THREE.Group();
  const field = makeSky(2600, 0.6, 16, 0.06, ["#ffffff", "#dfe8e3", "#c9d6cf"]);
  const drift = makeSky(140, 1.6, 9, 0.11, ["#9ee6b8", "#bdf0cf"]);
  sky.add(field, drift);
  scene.add(sky);

  // ping ripples
  const ripples = [];
  const ping = () => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.72, 96), new THREE.MeshBasicMaterial({ color: 0x9ee6b8, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.copy(rig.position);
    scene.add(ring);
    ripples.push({ ring, t: 0 });
    boost = 1;
    onPing?.();
  };

  // theme: in light mode the sky becomes ink on paper
  const applyTheme = () => {
    const light = document.documentElement.dataset.theme === "light";
    field.material.blending = drift.material.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    field.material.color.set(light ? 0x0f1a14 : 0xffffff);
    drift.material.color.set(light ? 0x0b6b3a : 0xffffff);
    field.material.opacity = light ? 0.55 : 1;
    field.material.needsUpdate = drift.material.needsUpdate = true;
    renderer.toneMappingExposure = light ? 0.95 : 1.05;
  };
  applyTheme();
  addEventListener("polaris:theme", applyTheme);

  // layout: star on the right on wide screens, above the text on narrow ones
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const wide = w / h > 1.1;
    rig.position.set(wide ? 1.35 : 0, wide ? 0.05 : 1.12, 0);
    rig.scale.setScalar(wide ? 1.2 : Math.min(0.52, camera.aspect * 0.95));
    sky.position.copy(rig.position);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  // interaction
  const pointer = { x: 0, y: 0 };
  let spin = 0, spinV = 0, dragging = false, lastX = 0, moved = 0, boost = 0, scrollP = 0;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hit = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects([star, ...arcs.children]).length > 0;
  };
  addEventListener("pointermove", (e) => {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
    if (dragging) { spinV = (e.clientX - lastX) * 0.012; moved += Math.abs(e.clientX - lastX); lastX = e.clientX; }
    else canvas.style.cursor = hit(e) ? "grab" : "";
  }, { passive: true });
  canvas.addEventListener("pointerdown", (e) => { if (!hit(e)) return; dragging = true; moved = 0; lastX = e.clientX; canvas.style.cursor = "grabbing"; });
  addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = "grab";
    if (moved < 4 && hit(e)) ping();
  });

  // run only while visible
  let visible = true, raf = 0;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible && !raf) loop(); }).observe(canvas);
  const clock = new THREE.Clock();
  function loop() {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (!dragging) spinV *= 0.94;
    spin += spinV;
    boost *= 0.96;
    rig.rotation.y += ((spin + pointer.x * 0.35 + scrollP * 1.2) - rig.rotation.y) * 0.08;
    rig.rotation.x += ((pointer.y * 0.25 + Math.sin(t * 0.4) * 0.03) - rig.rotation.x) * 0.06;
    if (!reduce) {
      field.rotation.z += dt * (0.018 + boost * 0.25);
      drift.rotation.z += dt * (0.05 + boost * 0.6);
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.t += dt;
      r.ring.scale.setScalar(1 + r.t * 3.2);
      r.ring.material.opacity = Math.max(0, 0.8 - r.t * 0.7);
      if (r.t > 1.2) { scene.remove(r.ring); r.ring.geometry.dispose(); r.ring.material.dispose(); ripples.splice(i, 1); }
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  loop();

  return { ping, setScroll: (p) => (scrollP = p) };
}
