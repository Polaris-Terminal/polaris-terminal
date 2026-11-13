// Radar planet: one persistent globe behind the whole landing page. It rises out of the hero, then glides
// between chapters along a scroll path (see path.js), spins a little with every scroll, drags like a trackball
// with inertia and eases back into a slow spin two and a half seconds after it is let go. The surface is a
// lit dot-matrix Earth swept by a radar beam; Drift tokens stand on it as signal spikes, and Polaris sits
// on the end of its axis.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildPath, samplePath } from "./path.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt); // frame-rate independent easing
const GREEN = new THREE.Color("#00ff41");
const SUN = new THREE.Vector3(-0.92, 0.55, 0.48).normalize(); // fixed to the camera, so the terminator stays put
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.37);
const Y = new THREE.Vector3(0, 1, 0);

// chapter poses [x, y, r, dim, overlay]; a [data-globe-slot] inside the chapter overrides x, y and r
const POSES = {
  wide: {
    hero: [0.5, 1.4, 0.8, 1, 0.55], drift: [0.72, 0.56, 0.38, 1, 1], console: [0.78, 0.55, 0.3, 0.85, 0.3],
    instruments: [-0.03, 0.6, 0.36, 0.42, 0], vaults: [1.03, 0.56, 0.36, 0.42, 0], beacon: [-0.03, 0.58, 0.34, 0.42, 0],
    contracts: [1.03, 0.56, 0.34, 0.36, 0], final: [0.5, 0.55, 0.32, 1, 0.6],
  },
  tablet: {
    hero: [0.5, 1.16, 0.78, 1, 0.55], drift: [0.5, 0.6, 0.44, 1, 1], console: [0.5, 0.6, 0.44, 0.3, 0],
    instruments: [0.5, 0.6, 0.44, 0.24, 0], vaults: [0.5, 0.6, 0.44, 0.24, 0], beacon: [0.5, 0.6, 0.44, 0.24, 0],
    contracts: [0.5, 0.6, 0.44, 0.24, 0], final: [0.5, 0.58, 0.42, 1, 0.6],
  },
  mobile: {
    hero: [0.5, 1.12, 0.98, 1, 0.55], drift: [0.5, 0.55, 0.46, 1, 1], console: [0.5, 0.62, 0.46, 0.28, 0],
    instruments: [0.5, 0.62, 0.46, 0.22, 0], vaults: [0.5, 0.62, 0.46, 0.22, 0], beacon: [0.5, 0.62, 0.46, 0.22, 0],
    contracts: [0.5, 0.62, 0.46, 0.22, 0], final: [0.5, 0.58, 0.44, 1, 0.6],
  },
};
const REST = new Set(["hero", "drift", "console", "final"]);

function chapters(w, h) {
  const table = w <= 720 ? POSES.mobile : w <= 980 ? POSES.tablet : POSES.wide;
  return [...document.querySelectorAll("[data-story]")].flatMap((sec) => {
    const name = sec.dataset.story;
    if (!table[name]) return [];
    let [x, y, r, dim, ov] = table[name];
    const at = name === "hero" ? 0 : sec.getBoundingClientRect().top + scrollY - h * 0.12;
    const slot = sec.querySelector("[data-globe-slot]")?.getBoundingClientRect();
    if (slot?.width > 40) {
      x = (slot.left + slot.width / 2) / w;
      y = (slot.top + scrollY - at + slot.height / 2) / h;
      r = (0.7 * Math.min(slot.width, slot.height)) / 2 / Math.min(w, h); // the bezel reaches ~1.45R, keep it inside the slot
    }
    if (name === "hero") { // rise just under the hero copy
      const copy = sec.querySelector(".hero-copy")?.getBoundingClientRect();
      const below = copy ? copy.bottom + scrollY + 36 : h * 0.68;
      y = Math.max(y, (Math.max(h * 0.72, below) + r * Math.min(w, h)) / h);
    }
    return [{ at, x, y, r, dim, ov, name, rest: REST.has(name) }];
  });
}

// lat/lng (radians) to a unit vector in the planet frame: lng 0 on +x, east towards -z, as the sphere UVs run
const dir = (lat, lng) => new THREE.Vector3(Math.cos(lat) * Math.cos(lng), Math.sin(lat), -Math.cos(lat) * Math.sin(lng));

// trackball: inside the disc the pointer lands on a sphere, outside on a hyperbolic sheet, so the rim never flips
function onBall(px, py, c, out) {
  out.set((px - c.x) / c.r, (c.y - py) / c.r, 0);
  const d = out.x * out.x + out.y * out.y;
  out.z = d <= 0.5 ? Math.sqrt(1 - d) : 0.5 / Math.sqrt(d);
  return out.normalize();
}

// ---------- shaders ----------
const SURF_V = `
varying vec3 vN; varying vec3 vView; varying vec3 vObj; varying vec2 vRel; varying vec2 vUv;
void main() {
  vUv = uv; vObj = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  vRel = p.xy - (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xy;
  vN = normalize(normalMatrix * normal); vView = -p.xyz;
  gl_Position = projectionMatrix * p;
}`;
const SWEEP = `
uniform float uSweep;
// 0 ahead of the beam, 1 on its edge, fading behind it like phosphor on a scope
float sweep(vec2 rel) {
  float d = mod(atan(rel.y, rel.x) - uSweep, 6.2831853);
  return exp(-d * 2.4) + smoothstep(0.035, 0.0, d);
}`;
const SURF_F = `
uniform sampler2D uLand; uniform vec3 uSun; uniform vec3 uGreen; uniform float uCells, uTime, uDim; uniform vec4 uPings[8];
varying vec3 vN; varying vec3 vView; varying vec3 vObj; varying vec2 vRel; varying vec2 vUv;
${SWEEP}
void main() {
  vec3 n = normalize(vN), v = normalize(vView), o = normalize(vObj);
  float lat = degrees(asin(clamp(o.y, -1.0, 1.0))), lng = degrees(atan(-o.z, o.x));
  float light = dot(n, uSun), day = smoothstep(-0.12, 0.35, light);
  float land = smoothstep(0.3, 0.7, texture2D(uLand, vUv).r);

  // dot matrix: latitude bands with as many cells as fit the circumference, one dot per land cell
  float band = 180.0 / uCells, row = floor((lat + 90.0) / band), rowLat = (row + 0.5) * band - 90.0;
  float cols = max(1.0, floor(uCells * 2.0 * cos(radians(rowLat)))), cw = 360.0 / cols;
  vec2 cc = vec2((floor((lng + 180.0) / cw) + 0.5) * cw - 180.0, rowLat);
  float aa = fwidth(lat) / band;
  float dotm = 1.0 - smoothstep(0.3 - aa, 0.3 + aa, length(vec2((lng - cc.x) / cw, (lat - cc.y) / band)));
  float cellLand = step(0.5, textureLod(uLand, vec2((cc.x + 180.0) / 360.0, (cc.y + 90.0) / 180.0), 0.0).r);
  float dots = mix(dotm, 0.32, smoothstep(0.35, 0.6, aa)) * cellLand; // tiny cells become a flat tint, not moire

  // graticule every 15 degrees
  float px = fwidth(lat) * 1.2;
  float gLat = abs(fract(lat / 15.0 + 0.5) - 0.5) * 15.0, gLng = abs(fract(lng / 15.0 + 0.5) - 0.5) * 15.0 * cos(radians(lat));
  float grid = min(1.0, (1.0 - smoothstep(0.0, px, gLat)) + (1.0 - smoothstep(0.0, px, gLng)));

  float sw = sweep(vRel);
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    float age = uTime - uPings[i].w;
    if (age < 0.0 || age > 2.6) continue;
    float ang = acos(clamp(dot(o, uPings[i].xyz), -1.0, 1.0));
    ring += exp(-abs(ang - age * 0.42) * 60.0) * (1.0 - age / 2.6) + exp(-ang * 28.0) * max(0.0, 1.0 - age * 2.5);
  }

  vec3 ocean = vec3(0.0, 0.004, 0.002) + vec3(0.0, 0.018, 0.009) * day;
  vec3 ground = vec3(0.002, 0.03, 0.012) * (0.35 + 0.9 * day);
  vec3 col = mix(ocean, ground, land);
  col += uGreen * dots * (0.13 + 0.2 * (1.0 - day) + sw * 0.95); // land glows like city light, brightest under the beam
  col += uGreen * grid * (0.035 + sw * 0.22);
  vec3 hv = normalize(uSun + v);
  col += vec3(0.5, 1.0, 0.68) * pow(max(dot(n, hv), 0.0), 90.0) * (1.0 - land) * day * 0.55; // sun glint on water
  col += uGreen * pow(1.0 - max(dot(n, v), 0.0), 3.0) * (0.18 + 0.4 * day);                     // thin atmosphere at the limb
  col += uGreen * ring * 1.5;
  gl_FragColor = vec4(col * uDim, 1.0);
  #include <colorspace_fragment>
}`;
const UV_V = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HALO_F = `
uniform float uEdge, uDim; varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0; float r = length(p), out_ = max(0.0, r - uEdge);
  float glow = exp(-out_ * 15.0) * smoothstep(uEdge - 0.004, uEdge + 0.012, r) * (1.0 - smoothstep(0.8, 1.0, r));
  vec3 c = mix(vec3(0.0, 0.2, 0.05), vec3(0.15, 1.0, 0.35), exp(-out_ * 32.0));
  gl_FragColor = vec4(c, glow * 0.48 * uDim);
  #include <colorspace_fragment>
}`;
const BEZEL_F = `
uniform sampler2D uMap; uniform vec3 uGreen; uniform float uDim, uBezel; varying vec2 vUv;
${SWEEP}
void main() {
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  float beam = sweep(p) * smoothstep(0.69, 0.72, r) * (1.0 - smoothstep(0.95, 0.99, r));
  float a = texture2D(uMap, vUv).r * (0.32 + beam * 1.3) + beam * 0.16;
  gl_FragColor = vec4(uGreen, a * uDim * uBezel);
  #include <colorspace_fragment>
}`;
const CAP_V = `
attribute float aSize; attribute float aHot; uniform float uPx; varying float vHot;
void main() { vHot = aHot; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_PointSize = max(2.0, aSize * uPx); }`;
const CAP_F = `
uniform vec3 uGreen; uniform float uOv, uDim; varying float vHot;
void main() {
  float d = length(gl_PointCoord - 0.5), a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(mix(uGreen, vec3(0.85, 1.0, 0.9), vHot), a * a * uOv * uDim * (0.7 + 0.6 * vHot));
  #include <colorspace_fragment>
}`;
const ARC_V = `attribute float aT; attribute float aSeed; varying float vT; varying float vSeed;
void main() { vT = aT; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ARC_F = `
uniform vec3 uGreen; uniform float uTime, uOv, uDim; varying float vT; varying float vSeed;
void main() {
  float head = fract(uTime * 0.4 + vSeed), pk = exp(-pow((vT - head) * 12.0, 2.0)); // a packet runs to the North Pick
  gl_FragColor = vec4(mix(uGreen, vec3(0.9, 1.0, 0.92), pk), (0.14 + pk) * uOv * uDim);
  #include <colorspace_fragment>
}`;
const STAR_V = `uniform float uStar; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uStar; }`;
const STAR_F = `
uniform float uTime, uDim;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0; float x = abs(p.x), y = abs(p.y);
  float rays = exp(-x * 16.0) * exp(-y * 2.6) + exp(-y * 16.0) * exp(-x * 2.6); // four points, like the mark
  float a = (rays + exp(-dot(p, p) * 20.0)) * (0.82 + 0.18 * sin(uTime * 2.2));
  gl_FragColor = vec4(vec3(0.8, 1.0, 0.86), clamp(a, 0.0, 1.0) * uDim);
  #include <colorspace_fragment>
}`;
const SKY_F = `
uniform float uTime; varying vec2 vUv;
void main() {
  float s = sin(uTime * 0.02) * 0.03;
  vec3 c = vec3(0.0003, 0.0018, 0.0009);
  c += vec3(0.001, 0.02, 0.007) * exp(-length((vUv - vec2(-0.1 + s, 0.45)) * vec2(1.4, 0.8)) * 3.4);
  c += vec3(0.0008, 0.015, 0.006) * exp(-length((vUv - vec2(1.12, 0.28 + s)) * vec2(1.3, 0.85)) * 3.6);
  c += vec3(0.001, 0.012, 0.005) * exp(-length((vUv - vec2(0.55, 0.02)) * vec2(1.0, 1.7)) * 5.5);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
const DUST_V = `attribute float aSize; attribute vec3 aColor; uniform float uDpr; varying vec3 vColor;
void main() { vColor = aColor; gl_Position = vec4(position.xy, 0.99, 1.0); gl_PointSize = max(1.0, aSize * uDpr); }`;
const DUST_F = `varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor * (1.0 - smoothstep(0.05, 0.5, d)), 1.0);
  #include <colorspace_fragment>
}`;

// compass bezel around the globe: ticks every 2 degrees, bearings every 30
function bezelTexture() {
  const S = 1024, m = S / 2, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), tex = new THREE.CanvasTexture(c);
  const draw = () => {
    g.clearRect(0, 0, S, S);
    g.strokeStyle = g.fillStyle = "#fff";
    g.lineWidth = 2; g.beginPath(); g.arc(m, m, m * 0.985, 0, TAU); g.stroke();
    g.lineWidth = 1.2; g.beginPath(); g.arc(m, m, m * 0.8, 0, TAU); g.stroke();
    for (let d = 0; d < 360; d += 2) {
      const a = (d * Math.PI) / 180, k = d % 30 ? (d % 10 ? 0.955 : 0.925) : 0.89;
      g.lineWidth = d % 10 ? 1 : 2;
      g.beginPath(); g.moveTo(m + Math.sin(a) * m * k, m - Math.cos(a) * m * k); g.lineTo(m + Math.sin(a) * m * 0.985, m - Math.cos(a) * m * 0.985); g.stroke();
    }
    g.font = `500 ${S * 0.022}px "Geist Mono", ui-monospace, monospace`;
    g.textAlign = "center"; g.textBaseline = "middle";
    for (let d = 0; d < 360; d += 30) { const a = (d * Math.PI) / 180; g.fillText(String(d).padStart(3, "0"), m + Math.sin(a) * m * 0.845, m - Math.cos(a) * m * 0.845); }
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.ready.then(draw);
  return tex;
}

export function mountGlobe({ layer, canvas, target, hint, tip, describe = (t) => t.symbol, onPing, onSelect, onStory }) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = innerWidth <= 720;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x010603, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  camera.position.z = 8;
  const root = new THREE.Group(), planet = new THREE.Group(); // root: placement and scale; planet: orientation
  root.add(planet);
  scene.add(root);

  const U = { uTime: { value: 0 }, uSweep: { value: 0 }, uDim: { value: 1 }, uOv: { value: 0 }, uPx: { value: 100 }, uGreen: { value: GREEN } };
  const pings = Array.from({ length: 8 }, () => new THREE.Vector4(0, 1, 0, -99));
  let pingIx = 0;
  const addPing = (d) => { pings[pingIx].set(d.x, d.y, d.z, U.uTime.value); pingIx = (pingIx + 1) % pings.length; };

  // land mask; a small CPU copy decides where token spikes may stand
  let landAt = () => true;
  const land = new THREE.TextureLoader().load("/assets/land.png", (t) => {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 256;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(t.image, 0, 0, 512, 256);
    const px = g.getImageData(0, 0, 512, 256).data;
    landAt = (lat, lng) => px[((Math.min(255, ((0.5 - lat / Math.PI) * 256) | 0) * 512 + Math.min(511, ((lng / TAU + 0.5) * 512) | 0)) * 4)] > 127;
    if (list.length) setTokens(list.map((e) => e.t));
    ready();
  }, undefined, () => ready());
  land.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, small ? 96 : 160, small ? 64 : 112),
    new THREE.ShaderMaterial({ vertexShader: SURF_V, fragmentShader: SURF_F, uniforms: { ...U, uLand: { value: land }, uSun: { value: SUN }, uCells: { value: 180 }, uPings: { value: pings } } }),
  );
  planet.add(surface);

  const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), new THREE.ShaderMaterial({
    vertexShader: UV_V, fragmentShader: HALO_F, uniforms: { uDim: U.uDim, uEdge: { value: 0.6 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.position.z = -0.3;
  halo.renderOrder = -1;
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShaderMaterial({
    vertexShader: UV_V, fragmentShader: BEZEL_F, uniforms: { ...U, uMap: { value: bezelTexture() }, uBezel: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  root.add(halo, bezel);

  // Polaris on the end of the axis, with a faint axis line from the pole
  const axisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0, 1.36, 0)]);
  const axis = new THREE.Line(axisGeo, new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  const star = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.44, 0)]), new THREE.ShaderMaterial({
    vertexShader: STAR_V, fragmentShader: STAR_F, uniforms: { ...U, uStar: { value: 40 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  planet.add(axis, star);

  // data overlay: spikes, caps and arcs, rebuilt whenever the Drift changes
  const overlay = new THREE.Group();
  planet.add(overlay);
  const spikeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const capMat = new THREE.ShaderMaterial({ vertexShader: CAP_V, fragmentShader: CAP_F, uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const arcMat = new THREE.ShaderMaterial({ vertexShader: ARC_V, fragmentShader: ARC_F, uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const spikes = new THREE.LineSegments(new THREE.BufferGeometry(), spikeMat);
  const caps = new THREE.Points(new THREE.BufferGeometry(), capMat);
  const arcs = new THREE.LineSegments(new THREE.BufferGeometry(), arcMat);
  overlay.add(spikes, caps, arcs);

  // deep-space backdrop: a slow green nebula and fixed dust, both in screen space
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }`, fragmentShader: SKY_F, uniforms: U, depthWrite: false, depthTest: false,
  }));
  let seed = 46630;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const n = small ? 520 : 1100, dp = [], ds = [], dc = [];
  for (let i = 0; i < n; i++) {
    const k = rnd();
    dp.push(rnd() * 2 - 1, rnd() * 2 - 1, 0);
    ds.push(k > 0.985 ? 2.2 : k > 0.86 ? 1.3 : 0.7);
    const c = new THREE.Color(k > 0.93 ? "#b9ffcb" : rnd() > 0.7 ? "#7dffa0" : "#5c8f6b").multiplyScalar(k > 0.985 ? 0.9 : 0.08 + rnd() * 0.3);
    dc.push(c.r, c.g, c.b);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.Float32BufferAttribute(dp, 3));
  dustGeo.setAttribute("aSize", new THREE.Float32BufferAttribute(ds, 1));
  dustGeo.setAttribute("aColor", new THREE.Float32BufferAttribute(dc, 3));
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({ vertexShader: DUST_V, fragmentShader: DUST_F, uniforms: { uDpr: { value: 1 } }, depthWrite: false, depthTest: false }));
  [sky, dust].forEach((o, i) => { o.frustumCulled = false; o.renderOrder = i - 21; scene.add(o); });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), small ? 0.6 : 0.75, 0.55, 0.42);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // light theme: the planet sits on paper, so no backdrop, no bloom and no additive glow
  let light = false;
  const applyTheme = () => {
    light = document.documentElement.dataset.theme === "light";
    sky.visible = dust.visible = !light;
    renderer.setClearColor(0x010603, light ? 0 : 1);
    for (const m of [halo.material, bezel.material, axis.material, star.material, spikeMat, capMat, arcMat]) { m.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending; m.needsUpdate = true; }
  };
  applyTheme();
  addEventListener("polaris:theme", applyTheme);

  // ---------- tokens ----------
  let list = [], selected = null, top = null;
  // a stable spot on land for every address (tries a few hashes, stays clear of the poles)
  function spot(addr) {
    let h = parseInt(addr.slice(2, 10), 16) >>> 0 || 1, lat = 0, lng = 0;
    for (let k = 0; k < 12; k++) {
      h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
      lat = Math.asin(-0.83 + ((h & 0xffff) / 65536) * 1.78);
      lng = ((h >>> 16) / 65536) * TAU - Math.PI;
      if (landAt(lat, lng)) break;
    }
    return dir(lat, lng);
  }
  function setTokens(tokens) {
    const seen = new Set(list.map((e) => e.t.address));
    const maxS = Math.max(...tokens.map((t) => t.score), 1), maxH = Math.max(...tokens.map((t) => t.holders || 1), 10);
    list = tokens.slice(0, 64).map((t) => {
      const d = spot(t.address), len = 0.05 + 0.3 * (t.score / maxS);
      return { t, d, tip: d.clone().multiplyScalar(1 + len), size: 0.018 + 0.03 * Math.sqrt(Math.log10((t.holders || 1) + 1) / Math.log10(maxH + 1)) };
    });
    top = list[0] || null;
    if (seen.size) list.forEach((e) => { if (!seen.has(e.t.address)) addPing(e.d); }); // newborn flash
    if (selected) selected = list.find((e) => e.t.address === selected.t.address) || null;
    const sp = [], sc = [], cp = [], cs = [], ap = [], at = [], as = [];
    const base = new THREE.Color(0x00330d), tipC = new THREE.Color(GREEN), hot = new THREE.Color(0xd8ffe2);
    for (const e of list) {
      sp.push(...e.d.clone().multiplyScalar(1.002).toArray(), ...e.tip.toArray());
      sc.push(...base.toArray(), ...(e === top ? hot : tipC).toArray());
      cp.push(...e.tip.toArray());
      cs.push(e.size);
    }
    // arcs from the five next strongest to the North Pick
    list.slice(1, 6).forEach((e, j) => {
      const a = e.d, b = top.d, ang = a.angleTo(b), seg = 48;
      if (ang < 0.02) return;
      let prev = a.clone().multiplyScalar(1.01);
      for (let i = 1; i <= seg; i++) {
        const t = i / seg, p = a.clone().multiplyScalar(Math.sin((1 - t) * ang)).addScaledVector(b, Math.sin(t * ang)).divideScalar(Math.sin(ang)).normalize().multiplyScalar(1.01 + Math.sin(t * Math.PI) * 0.12 * ang);
        ap.push(...prev.toArray(), ...p.toArray());
        at.push((i - 1) / seg, t);
        as.push(j * 0.19, j * 0.19);
        prev = p;
      }
    });
    const geo = (o, attrs) => { o.geometry.dispose(); o.geometry = new THREE.BufferGeometry(); for (const [k, v, s] of attrs) o.geometry.setAttribute(k, new THREE.Float32BufferAttribute(v, s)); };
    geo(spikes, [["position", sp, 3], ["color", sc, 3]]);
    geo(caps, [["position", cp, 3], ["aSize", cs, 1], ["aHot", list.map((e) => (e === top || e === selected ? 1 : 0)), 1]]);
    geo(arcs, [["position", ap, 3], ["aT", at, 1], ["aSeed", as, 1]]);
  }
  function markHot() {
    const a = caps.geometry.getAttribute("aHot");
    if (!a) return;
    list.forEach((e, i) => a.setX(i, e === top || e === selected ? 1 : 0));
    a.needsUpdate = true;
  }

  // ---------- motion state ----------
  let w = 1, h = 1, path = { pts: [], m: {} }, pr = 1;
  const goal = { x: 0.5, y: 1.4, r: 0.8, dim: 1, ov: 0.5 }, cur = { ...goal }, center = { x: 0, y: 0, r: 1 };
  const user = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.2, 0.02)), initial = user.clone();
  const spinQ = new THREE.Quaternion(), dq = new THREE.Quaternion(), prev = new THREE.Vector3(), now3 = new THREE.Vector3(), flingAxis = new THREE.Vector3(0, 1, 0);
  let phase = 0, spinSpeed = 0, speed = 0, drag = false, down = null, lastInput = -1e4, lastPointer = 0, paused = reduce, facing = null;
  let lastScroll = null, entranceAt = -1, revealAt = -1, nextAuto = 0, hover = null, shown = false;

  function measure() { path = buildPath(chapters(w, h)); }
  function resize() {
    w = document.documentElement.clientWidth; h = innerHeight;
    camera.aspect = w / h;
    pr = Math.min(devicePixelRatio, w <= 720 ? 1.25 : 1.5);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    composer.setPixelRatio(pr); composer.setSize(w, h);
    dust.material.uniforms.uDpr.value = pr;
    lastScroll = null;
    measure();
  }
  addEventListener("resize", resize);
  new ResizeObserver(measure).observe(document.querySelector("main") || document.body);
  document.fonts?.ready.then(measure);
  resize();
  samplePath(path, scrollY, cur);

  // ---------- input ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), tmp = new THREE.Vector3();
  function pick(x, y) {
    if (U.uOv.value < 0.15) return null;
    let best = null, bd = 18 * 18;
    for (const e of list) {
      if (tmp.copy(e.d).applyQuaternion(planet.quaternion).z < -0.12) continue; // on the far side
      tmp.copy(e.tip).applyMatrix4(planet.matrixWorld).project(camera);
      const d = ((tmp.x + 1) / 2 * w - x) ** 2 + ((1 - tmp.y) / 2 * h - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function showTip(e, x, y) {
    hover = e;
    target.classList.toggle("on-token", !!e);
    if (!tip) return;
    tip.hidden = !e;
    if (!e) return;
    tip.innerHTML = describe(e.t);
    tip.style.transform = `translate(${Math.min(x + 16, w - 240)}px, ${Math.max(y - 70, 70)}px)`;
  }
  function select(t, quiet = false) {
    selected = list.find((e) => e.t.address === t?.address) || null;
    markHot();
    if (!selected) return;
    addPing(selected.d);
    if (quiet) return;
    // turn the planet so the token faces the viewer, by the shortest rotation from where it is now
    const world = selected.d.clone().applyQuaternion(planet.quaternion);
    facing = new THREE.Quaternion().setFromUnitVectors(world, new THREE.Vector3(0, 0.25, 1).normalize()).multiply(user).normalize();
    lastInput = performance.now();
    speed = 0;
  }
  function pingAt(x, y) {
    ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(surface)[0];
    if (!hit) return;
    addPing(surface.worldToLocal(hit.point).normalize());
    onPing?.();
  }

  target.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const inside = Math.hypot(e.clientX - center.x, e.clientY - center.y) <= center.r * 1.05;
    if (!inside && !hover) return;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, far: 0 };
    if (e.pointerType === "touch" || !inside) return; // touch keeps scrolling the page; taps still ping
    drag = true; speed = 0; facing = null;
    onBall(e.clientX, e.clientY, center, prev);
    lastInput = lastPointer = performance.now();
    try { target.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    target.classList.add("dragging");
    e.preventDefault();
  });
  target.addEventListener("pointermove", (e) => {
    if (down?.id === e.pointerId) down.far = Math.max(down.far, Math.hypot(e.clientX - down.x, e.clientY - down.y));
    if (!drag || e.pointerId !== down?.id) { if (e.pointerType !== "touch") { const p = pick(e.clientX, e.clientY); showTip(p, e.clientX, e.clientY); } return; }
    const t = performance.now();
    onBall(e.clientX, e.clientY, center, now3);
    dq.setFromUnitVectors(prev, now3);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(dq.w))), s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    if (s > 1e-4) { flingAxis.set(dq.x, dq.y, dq.z).divideScalar(s).normalize(); speed = Math.min(2.3, ang / Math.max(0.008, (t - lastPointer) / 1000)); }
    user.premultiply(dq).normalize();
    prev.copy(now3);
    lastInput = lastPointer = t;
    showTip(null);
  });
  const release = (e, cancel) => {
    if (!down || e.pointerId !== down.id) return;
    if (drag) {
      drag = false;
      if (cancel || performance.now() - lastPointer > 80) speed = 0;
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      target.classList.remove("dragging");
    }
    if (!cancel && down.far < 5) {
      const p = pick(e.clientX, e.clientY);
      if (p) { select(p.t); onSelect?.(p.t); } else pingAt(e.clientX, e.clientY);
    }
    lastInput = performance.now();
    down = null;
  };
  target.addEventListener("pointerup", (e) => release(e, false));
  target.addEventListener("pointercancel", (e) => release(e, true));
  target.addEventListener("pointerleave", () => { if (!drag) showTip(null); });
  target.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pingAt(center.x, center.y - center.r * 0.2); return; }
    const k = { ArrowLeft: [Y, -1], ArrowRight: [Y, 1], ArrowUp: [new THREE.Vector3(1, 0, 0), -1], ArrowDown: [new THREE.Vector3(1, 0, 0), 1] }[e.key];
    if (!k) return;
    e.preventDefault();
    dq.setFromAxisAngle(k[0], k[1] * 0.12);
    user.premultiply(dq).normalize();
    lastInput = performance.now();
    speed = 0; facing = null;
  });

  // ---------- frame ----------
  let raf = 0, last = 0, firstFrame = true, assets = false, size = 0, story = "";
  function ready() { assets = true; }
  function tick(t) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(last ? (t - last) / 1000 : 1 / 60, 0.05);
    last = t;
    samplePath(path, scrollY, goal);
    if (reduce) Object.assign(goal, { x: 0.5, y: 0.62, r: w <= 720 ? 0.46 : 0.36, dim: 0.55, ov: 0.6 });
    if (!drag) {
      const k = reduce ? 1 : damp(revealAt >= 0 && t - revealAt < 1400 ? 4 : 12, dt);
      for (const key of ["x", "y", "r", "dim", "ov"]) cur[key] += (goal[key] - cur[key]) * k;
    }
    let lift = 0;
    if (entranceAt >= 0) {
      const f = Math.min(1, (t - entranceAt) / 1750);
      lift = (1 - f) ** 4 * h * 0.19;
      if (f >= 1) entranceAt = -1;
    }
    center.x = cur.x * w; center.y = cur.y * h + lift; center.r = cur.r * Math.min(w, h);
    const focal = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const s = (center.r * 8) / Math.sqrt(focal * focal + center.r * center.r); // world scale that projects to center.r px
    camera.setViewOffset(w, h, w / 2 - center.x, h / 2 - center.y, w, h);
    root.scale.setScalar(s);
    halo.material.uniforms.uEdge.value = center.r / ((focal * s * 1.9) / (8 + 0.3 * s));

    // spin: idle rotation fades in 2.5 s after the last touch; scrolling turns the planet too
    const idle = !paused && !drag && t - lastInput > 2500;
    spinSpeed += ((idle ? 1 : 0) - spinSpeed) * damp(idle ? 2.5 : 20, dt);
    phase = (phase + (TAU / 180) * dt * spinSpeed) % TAU;
    if (!paused && !drag && lastScroll !== null) phase += ((scrollY - lastScroll) / h) * 0.72;
    lastScroll = scrollY;
    if (!drag && speed > 0.001) { dq.setFromAxisAngle(flingAxis, speed * dt); user.premultiply(dq).normalize(); speed *= Math.exp(-9 * dt); }
    if (facing && !drag) { user.slerp(facing, reduce ? 1 : damp(6, dt)).normalize(); if (user.angleTo(facing) < 1e-3) facing = null; }
    spinQ.setFromAxisAngle(Y, phase);
    planet.quaternion.copy(user).multiply(TILT).multiply(spinQ);

    U.uTime.value += dt;
    if (!paused) U.uSweep.value = (U.uSweep.value - dt * 1.15 + TAU) % TAU; // clockwise, like a scope
    U.uDim.value = cur.dim;
    U.uOv.value = clamp(cur.ov, 0, 1);
    U.uPx.value = center.r * pr;
    star.material.uniforms.uStar.value = Math.min(0.42 * center.r, 72) * pr;
    bezel.material.uniforms.uBezel.value = clamp((0.62 - cur.r) / 0.16, 0, 1); // a planet filling the screen drops its bezel
    spikeMat.opacity = U.uOv.value * cur.dim;
    bloom.strength = (small ? 0.6 : 0.75) * (0.4 + 0.6 * cur.dim);
    if (!paused && list.length && U.uOv.value > 0.25 && U.uTime.value > nextAuto) { // radar returns
      nextAuto = U.uTime.value + 1.3;
      addPing((selected && Math.random() < 0.4 ? selected : list[(Math.random() * Math.min(list.length, 24)) | 0]).d);
    }

    // DOM that follows the globe: the drag target, the hint and the story callback
    const R = Math.round(center.r * 1.2);
    target.style.transform = `translate(${center.x - R}px, ${center.y - R}px)`;
    if (R !== size) target.style.width = target.style.height = (size = R) * 2 + "px";
    if (hint) hint.style.transform = `translate(-50%, 0) translate(${center.x}px, ${clamp(center.y + center.r - 8, 80, h - 64)}px)`;
    if (goal.name !== story) {
      story = goal.name;
      hint?.classList.toggle("on", story === "hero");
      onStory?.(story);
    }

    if (light) renderer.render(scene, camera); else composer.render(dt);
    if (firstFrame && assets) { firstFrame = false; layer.classList.add("ready"); }
  }
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf);
    last = 0; lastScroll = null;
    if (!document.hidden) raf = requestAnimationFrame(tick);
  });
  raf = requestAnimationFrame(tick);

  return {
    setTokens,
    select,
    ping: () => pingAt(center.x, center.y - center.r * 0.2),
    reveal() {
      if (shown) return;
      shown = true;
      revealAt = performance.now();
      if (!reduce && scrollY < h * 0.2) entranceAt = revealAt;
    },
    pause() { paused = !paused; if (paused) { speed = 0; spinSpeed = 0; } return paused; },
    reset() { user.copy(initial); phase = 0; speed = 0; facing = null; lastInput = performance.now(); },
    measure,
  };
}
