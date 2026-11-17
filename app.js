// Room in a Window — live off-axis Gaussian-splat window with head tracking.
import * as THREE from "three";
import { SparkRenderer, SplatMesh, SplatEdit, SplatEditSdf } from "@sparkjsdev/spark";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const Q = new URLSearchParams(location.search);
const num = (k, d) => (Q.has(k) ? parseFloat(Q.get(k)) : d);
const vec = (k, d) => (Q.has(k) ? Q.get(k).split(",").map(Number) : d);

// ---------- Scene config ----------
// Sample: Mip-NeRF 360 "room" (Barron et al., CVPR 2022), 3DGS 7k-iter splat via HF dylanebert/3dgs.
const SCENE = {
  url: Q.get("scene") || "scenes/room.spz",
  eye: vec("pos", [0.3, 0.3, 4.2]),     // nominal eye (world, after y-up flip)
  yaw: num("yaw", 0),                    // degrees, around world Y
  pitch: num("pitch", -6),               // degrees
  vfov: num("fov", 64),                  // vertical FOV at nominal distance
  D: num("dist", 1.0),                   // nominal eye->glass distance (scene units)
  par: num("par", 0.24),                 // max eye shift (scene units) at |head|=1
  lights: null,                          // set below (world coords)
};

// ---------- Renderer ----------
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
const DPR = Math.min(window.devicePixelRatio || 1, num("dpr", 2));
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
const camera = new THREE.PerspectiveCamera(SCENE.vfov, innerWidth / innerHeight, 0.01, 200);
const spark = new SparkRenderer({ renderer });
scene.add(spark);

const room = new SplatMesh({
  url: SCENE.url,
  onProgress: (e) => { if (e.total) setLoad(Math.round((e.loaded / e.total) * 100)); },
});
room.quaternion.set(1, 0, 0, 0); // COLMAP y-down -> three.js y-up
scene.add(room);

// ---------- Per-splat lighting (Spark SplatEdit SDFs) ----------
const ambient = new SplatEdit({ rgbaBlendMode: "multiply" });
const ambSdf = new SplatEditSdf({ type: "all", color: new THREE.Color(1, 1, 1), opacity: 1 });
ambient.add(ambSdf); scene.add(ambient);
const glow = new SplatEdit({ rgbaBlendMode: "add_rgba", softEdge: num("soft", 1.6) });
const LIGHT_POS = [vec("l0", [-1.7, 0.6, -2.2]), vec("l1", [1.9, 1.6, -4.6]), vec("l2", [0.4, -1.3, 0.2])];
const glowSdfs = LIGHT_POS.map((p) => {
  const s = new SplatEditSdf({ type: "sphere", radius: num("lr", 1.1), color: new THREE.Color(0, 0, 0), opacity: 0 });
  s.position.set(...p); glow.add(s); return s;
});
scene.add(glow);

// ---------- Color grade pass (screen space, sRGB) ----------
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 },
    uExposure: { value: 1 }, uContrast: { value: 1 }, uSat: { value: 1 },
    uGain: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3(0, 0, 0) },
    uShadow: { value: new THREE.Vector3(0, 0, 0) }, uHigh: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: 1 }, uVignette: { value: 0.25 }, uGrain: { value: 0.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime,uExposure,uContrast,uSat,uGamma,uVignette,uGrain;
    uniform vec3 uGain,uLift,uShadow,uHigh; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
      c = (c - 0.5) * uContrast + 0.5;
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      c = mix(vec3(l), c, uSat);
      c += uShadow * pow(1.0 - clamp(l,0.,1.), 2.0) + uHigh * pow(clamp(l,0.,1.), 2.0);
      c = c * uGain + uLift * (1.0 - c);
      c = pow(max(c, 0.0), vec3(1.0 / uGamma));
      vec2 d = vUv - 0.5; c *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(d * vec2(1.0, 1.3)));
      c += (h(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c,0.,1.), 1.0);
    }`,
};
const composer = new EffectComposer(renderer);
composer.setPixelRatio(DPR);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);

// ---------- Styles ----------
const C = (r, g, b) => [r, g, b];
const STYLES = [
  { name: "Original", sub: "as captured", g: {}, amb: C(1, 1, 1), lights: [C(0,0,0), C(0,0,0), C(0,0,0)] },
  { name: "Industrial Modern", sub: "concrete · steel · Edison light",
    g: { uExposure: 0.9, uContrast: 1.25, uSat: 0.5, uGain: C(1.0, 0.97, 0.92), uShadow: C(-0.03, 0.02, 0.06), uHigh: C(0.07, 0.03, -0.03), uVignette: 0.55, uGrain: 0.035 },
    amb: C(0.72, 0.74, 0.8), lights: [C(0.95, 0.5, 0.12), C(0.7, 0.38, 0.1), C(0.25, 0.13, 0.03)] },
  { name: "Contemporary", sub: "clean · bright · neutral",
    g: { uExposure: 1.06, uContrast: 1.16, uSat: 0.78, uGain: C(0.95, 1.0, 1.07), uHigh: C(-0.01, 0.0, 0.03), uVignette: 0.22 },
    amb: C(1.04, 1.04, 1.06), lights: [C(0.0, 0.0, 0.0), C(0.12, 0.14, 0.18), C(0.18, 0.18, 0.2)] },
  { name: "Scandinavian", sub: "airy · pale wood · soft daylight",
    g: { uExposure: 1.18, uContrast: 0.86, uSat: 0.62, uGain: C(1.03, 1.0, 0.95), uLift: C(0.08, 0.075, 0.065), uHigh: C(0.02, 0.015, 0.0), uVignette: 0.1 },
    amb: C(1.06, 1.04, 1.0), lights: [C(0.1, 0.08, 0.05), C(0.1, 0.08, 0.05), C(0.2, 0.19, 0.17)] },
  { name: "Midnight Neon", sub: "after hours · cyan + magenta",
    g: { uExposure: 1.0, uContrast: 1.18, uSat: 1.2, uGain: C(0.95, 0.95, 1.05), uShadow: C(0.0, 0.0, 0.05), uVignette: 0.6, uGrain: 0.03 },
    amb: C(0.22, 0.24, 0.42), lights: [C(0.85, 0.08, 0.6), C(0.05, 0.6, 0.85), C(0.08, 0.05, 0.25)] },
];
const GDEF = { uExposure: 1, uContrast: 1, uSat: 1, uGain: C(1,1,1), uLift: C(0,0,0), uShadow: C(0,0,0), uHigh: C(0,0,0), uGamma: 1, uVignette: 0.25, uGrain: 0 };
let styleIdx = 0;
const target = { g: {}, amb: [1,1,1], lights: [[0,0,0],[0,0,0],[0,0,0]] };
function setStyle(i, bump = true) {
  styleIdx = (i + STYLES.length) % STYLES.length;
  const s = STYLES[styleIdx];
  target.g = { ...GDEF, ...s.g }; target.amb = s.amb; target.lights = s.lights;
  document.getElementById("chipName").textContent = s.name;
  document.getElementById("chipSub").textContent = s.sub;
  [...document.querySelectorAll("#dots b")].forEach((b, k) => b.classList.toggle("on", k === styleIdx));
  if (bump) { const ch = document.getElementById("chip"); ch.classList.add("bump"); setTimeout(() => ch.classList.remove("bump"), 220); }
  if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
}
const dots = document.getElementById("dots");
STYLES.forEach((_, k) => { const b = document.createElement("b"); b.onclick = (e) => { e.stopPropagation(); setStyle(k); }; dots.appendChild(b); });
setStyle(Q.has("style") ? parseInt(Q.get("style")) : 0, false);
function stepGrade(a) {
  const u = grade.uniforms;
  for (const k in target.g) {
    const v = target.g[k];
    if (Array.isArray(v)) { const cur = u[k].value; cur.set(cur.x + (v[0]-cur.x)*a, cur.y + (v[1]-cur.y)*a, cur.z + (v[2]-cur.z)*a); }
    else u[k].value += (v - u[k].value) * a;
  }
  const lc = (col, t) => col.setRGB(col.r + (t[0]-col.r)*a, col.g + (t[1]-col.g)*a, col.b + (t[2]-col.b)*a);
  lc(ambSdf.color, target.amb);
  glowSdfs.forEach((s, k) => lc(s.color, target.lights[k]));
}

// ---------- Head / input state ----------
// head: normalized viewer position relative to screen center. x,y in ~[-1.5,1.5], z = distance ratio (1 = nominal).
const head = { x: 0, y: 0, z: 1 };      // smoothed
const raw = { x: 0, y: 0, z: 1 };       // latest measurement
let mode = "drag"; // "face" | "tilt" | "drag" | "sim"
const modeBtn = document.getElementById("mode");
function setMode(m) {
  mode = m;
  const label = { face: "Head tracking", tilt: "Tilt", drag: matchMedia("(hover:hover)").matches ? "Mouse" : "Drag", sim: "Simulated" }[m];
  modeBtn.querySelector("span").textContent = label;
  modeBtn.className = m === "face" ? "live" : m === "tilt" ? "tilt" : "";
  const hint = document.getElementById("hint");
  hint.textContent = m === "face" ? "Move your head — the room stays put." :
    m === "tilt" ? "Tilt your phone to look around. Swipe to restyle." : "Drag to look around. Swipe to restyle.";
  hint.classList.remove("gone"); clearTimeout(setMode.t); setMode.t = setTimeout(() => hint.classList.add("gone"), 5000);
}

// --- Face tracking (MediaPipe Face Landmarker, runs fully on-device) ---
const face = { lm: null, video: document.getElementById("cam"), c0: null, d0: null, last: 0, lastSeen: 0, cur: null, fps: 0, n: 0 };
async function startFace() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 30 } } });
  face.video.srcObject = stream; await face.video.play();
  const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
  const fs = await FilesetResolver.forVisionTasks(new URL("vendor/@mediapipe/tasks-vision/wasm", location.href).href);
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: "models/face_landmarker.task", delegate }, runningMode: "VIDEO", numFaces: 1 });
  try { face.lm = await FaceLandmarker.createFromOptions(fs, opts("GPU")); }
  catch (e) { console.warn("GPU delegate failed, using CPU", e); face.lm = await FaceLandmarker.createFromOptions(fs, opts("CPU")); }
  setMode("face");
  const loop = () => {
    const v = face.video, now = performance.now();
    if (v.readyState >= 2 && now - face.last > 30) {
      face.last = now;
      const r = face.lm.detectForVideo(v, now);
      const L = r.faceLandmarks && r.faceLandmarks[0];
      if (L) {
        const a = L[33], b = L[263];
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const d = Math.hypot((a.x - b.x) * v.videoWidth, (a.y - b.y) * v.videoHeight);
        if (!face.c0) { face.c0 = [0.5, 0.45]; face.d0 = d; }
        face.cur = [cx, cy, d]; face.lastSeen = now; face.n++;
        raw.x = clamp(-(cx - face.c0[0]) / 0.22, -1.6, 1.6);
        raw.y = clamp(-(cy - face.c0[1]) / 0.22, -1.6, 1.6);
        raw.z = clamp(face.d0 / d, 0.5, 2.0);
      } else if (now - face.lastSeen > 900) { raw.x *= 0.9; raw.y *= 0.9; raw.z += (1 - raw.z) * 0.1; }
    }
    if (mode === "face") (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(loop) : requestAnimationFrame(loop));
  };
  loop();
}

// --- Gyro fallback ---
const tilt = { b0: null, g0: null, b: 0, g: 0, got: false };
function onOrient(e) {
  if (e.beta == null) return;
  tilt.got = true; tilt.b = e.beta; tilt.g = e.gamma;
  if (tilt.b0 == null) { tilt.b0 = e.beta; tilt.g0 = e.gamma; }
  if (mode === "tilt") { raw.x = clamp(-(tilt.g - tilt.g0) / 18, -1.6, 1.6); raw.y = clamp((tilt.b - tilt.b0) / 18, -1.6, 1.6); raw.z = 1; }
}
function requestTiltPermission() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") return D.requestPermission().then((s) => s === "granted").catch(() => false);
  return Promise.resolve(!!D);
}
function startTilt() {
  addEventListener("deviceorientation", onOrient);
  return new Promise((res) => setTimeout(() => res(tilt.got), 900));
}

// --- Pointer: swipe restyle, tap recenter, drag parallax ---
let ptr = null;
canvas.addEventListener("pointerdown", (e) => { ptr = { x: e.clientX, y: e.clientY, t: performance.now(), hx: raw.x, hy: raw.y, id: e.pointerId, moved: 0 }; });
canvas.addEventListener("pointermove", (e) => {
  if (mode === "drag" && e.pointerType === "mouse" && !ptr) { raw.x = (e.clientX / innerWidth - 0.5) * 2.4; raw.y = -(e.clientY / innerHeight - 0.5) * 2.4; return; }
  if (!ptr || e.pointerId !== ptr.id) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y; ptr.moved = Math.max(ptr.moved, Math.hypot(dx, dy));
  if (mode === "drag") { raw.x = clamp(ptr.hx + dx / (innerWidth * 0.35), -1.6, 1.6); raw.y = clamp(ptr.hy - dy / (innerHeight * 0.3), -1.6, 1.6); }
});
const endPtr = (e) => {
  if (!ptr || e.pointerId !== ptr.id) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y, dt = performance.now() - ptr.t;
  const swipe = Math.abs(dx) > 45 && Math.abs(dx) > 1.4 * Math.abs(dy) && Math.abs(dx) / dt > 0.25;
  if (swipe) { if (mode === "drag") { raw.x = ptr.hx; raw.y = ptr.hy; } setStyle(styleIdx + (dx < 0 ? 1 : -1)); }
  else if (ptr.moved < 10 && dt < 350) recenter();
  ptr = null;
};
canvas.addEventListener("pointerup", endPtr);
canvas.addEventListener("pointercancel", () => (ptr = null));
addEventListener("keydown", (e) => { if (e.key === "ArrowRight") setStyle(styleIdx + 1); if (e.key === "ArrowLeft") setStyle(styleIdx - 1); if (e.key === " ") recenter(); });

const toastEl = Object.assign(document.createElement("div"), { id: "toast" }); document.body.appendChild(toastEl);
function toast(t) { toastEl.textContent = t; toastEl.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove("on"), 1100); }
function recenter() {
  if (mode === "face" && face.cur) { face.c0 = [face.cur[0], face.cur[1]]; face.d0 = face.cur[2]; }
  if (mode === "tilt") { tilt.b0 = tilt.b; tilt.g0 = tilt.g; }
  raw.x = 0; raw.y = 0; raw.z = 1; toast("Recentered");
}
document.getElementById("recenter").onclick = (e) => { e.stopPropagation(); recenter(); };
modeBtn.onclick = (e) => { e.stopPropagation(); if (mode !== "face") document.getElementById("start").classList.remove("hidden"); };

// ---------- Off-axis window camera ----------
const baseQ = new THREE.Quaternion();
function updateBase() {
  baseQ.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(SCENE.pitch), THREE.MathUtils.degToRad(SCENE.yaw), 0, "YXZ"));
}
updateBase();
const tmp = new THREE.Vector3();
function updateCamera() {
  const aspect = innerWidth / innerHeight;
  const hh = SCENE.D * Math.tan(THREE.MathUtils.degToRad(SCENE.vfov / 2)), hw = hh * aspect;
  // eye in window-local coordinates (glass plane at z=0, viewer at +z)
  const ex = head.x * SCENE.par, ey = head.y * SCENE.par * 0.8, ez = Math.max(0.25, SCENE.D * head.z);
  const winCenter = new THREE.Vector3(...SCENE.eye).add(tmp.set(0, 0, -SCENE.D).applyQuaternion(baseQ));
  camera.position.copy(winCenter).add(tmp.set(ex, ey, ez).applyQuaternion(baseQ));
  camera.quaternion.copy(baseQ);
  camera.updateMatrixWorld(true);
  const n = 0.01, f = 200, k = n / ez;
  camera.projectionMatrix.makePerspective((-hw - ex) * k, (hw - ex) * k, (hh - ey) * k, (-hh - ey) * k, n, f);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

// ---------- Loop ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let lastT = performance.now(), frames = 0, fpsT = lastT, fps = 0;
function tick(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  const a = 1 - Math.exp(-dt * (mode === "face" ? 14 : 10));
  head.x += (raw.x - head.x) * a; head.y += (raw.y - head.y) * a; head.z += (raw.z - head.z) * a;
  stepGrade(1 - Math.exp(-dt * 6));
  grade.uniforms.uTime.value = (t / 1000) % 100;
  updateCamera();
  composer.render(dt);
  frames++; if (t - fpsT > 1000) { fps = frames * 1000 / (t - fpsT); frames = 0; fpsT = t; }
}
const ONDEMAND = Q.has("ondemand"); // headless testing: render only when asked
if (!ONDEMAND) renderer.setAnimationLoop(tick);
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight); });

// ---------- Boot ----------
const loadTxt = document.getElementById("loadTxt");
function setLoad(p) { loadTxt.textContent = `Loading room… ${p}%`; }
let loaded = false;
room.initialized.then(() => {
  loaded = true; setLoad(100);
  setTimeout(() => document.getElementById("loader").classList.add("done"), 250);
  if (Q.has("auto")) { setMode(Q.get("auto") === "sim" ? "sim" : "drag"); }
  else document.getElementById("start").classList.remove("hidden");
}).catch((e) => { loadTxt.textContent = "Couldn't load the room: " + e.message; });

async function begin(useCam) {
  document.getElementById("start").classList.add("hidden");
  const tiltOk = requestTiltPermission(); // must be called inside the tap on iOS
  if (useCam && navigator.mediaDevices?.getUserMedia) {
    try { await startFace(); return; } catch (e) { console.warn("camera unavailable", e); toast("Camera off — using tilt"); }
  }
  if (await tiltOk && await startTilt()) { setMode("tilt"); return; }
  setMode("drag");
}
document.getElementById("go").onclick = () => begin(true);
document.getElementById("nocam").onclick = () => begin(false);

// ---------- Test / debug hooks ----------
window.RW = {
  render(snap = true) { if (snap) { head.x = raw.x; head.y = raw.y; head.z = raw.z; stepGrade(1); } lastT = performance.now() - 16; tick(performance.now()); },
  get loaded() { return loaded; }, get mode() { return mode; }, get style() { return STYLES[styleIdx].name; },
  get fps() { return fps; }, get faceFrames() { return face.n; },
  head, raw, setHead(x, y, z = 1) { raw.x = x; raw.y = y; raw.z = z; head.x = x; head.y = y; head.z = z; },
  setStyle, setMode, begin, camera, mesh: room, scene: SCENE, numSplats: () => room.packedSplats?.numSplats ?? room.numSplats,
  camState() { return { pos: camera.position.toArray().map((v) => +v.toFixed(4)), proj8: +camera.projectionMatrix.elements[8].toFixed(4), proj9: +camera.projectionMatrix.elements[9].toFixed(4) }; },
};
