// Tesori delle Ombre - mostri 3D in realtà aumentata (Three.js)
//
// ART BIBLE
// Stile: creature dark fantasy realistiche, materiali fisici (chitina lucida, pietra, pelle ardente,
//        stoffa spettrale, carne bagnata), appoggiate al suolo reale con ombre di contatto.
// Palette: inchiostro #0B0A0F · osso #E8DCC4 · brace #D9A441 · sangue #B3202A · spettrale #6FD3E0
//          · ombra fredda #2A3346 · luce lunare #CFE0FF · terra #2A1E18 · cielo #6C7FA6
// Atmosfera: notte; luce chiave lunare fredda dall'alto a sinistra, ambiente cielo freddo / terra calda,
//            ogni creatura porta la propria luce (occhi, crepe, fiamme) che la illumina da dentro.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PAL = { ink: 0x0B0A0F, bone: 0xE8DCC4, ember: 0xD9A441, blood: 0xB3202A, spectral: 0x6FD3E0,
  slate: 0x2A3346, moon: 0xCFE0FF, earth: 0x2A1E18, sky: 0x6C7FA6 };
const D2R = Math.PI / 180;
const GROUND_Y = -1.45;      // il telefono è tenuto a ~1,45 m dal suolo
const DIST = 4.6;            // distanza del mostro dalla camera (m)

// ---------------------------------------------------------------- rumore
const perm = new Uint8Array(512);
(() => { const p = []; for (let i = 0; i < 256; i++) p[i] = i; let s = 1337;
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; })();
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y, z) { const u = (h & 15) < 8 ? x : y, v = (h & 15) < 4 ? y : ((h & 15) === 12 || (h & 15) === 14) ? x : z;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); }
function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
    lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}
function fbm(x, y, z, o = 4) { let a = .5, f = 1, s = 0; for (let i = 0; i < o; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2; a *= .5; } return s; }
// distanza ai bordi delle celle (crepe), tileable sul quadrato unitario
function cracks(u, v, n, seed = 0) {
  const x = u * n, y = v * n, ix = Math.floor(x), iy = Math.floor(y); let d1 = 9, d2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const h = Math.sin(wx * 127.1 + wy * 311.7 + seed * 74.7) * 43758.5453, h2 = Math.sin(wx * 269.5 + wy * 183.3 + seed * 19.3) * 43758.5453;
    const px = cx + (h - Math.floor(h)), py = cy + (h2 - Math.floor(h2)); const d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
// noise tileable in u (cilindrico) per le texture
const tn = (u, v, f, o = 4, sx = 0) => fbm(Math.cos(u * 2 * Math.PI) * f / 6.283 + sx, Math.sin(u * 2 * Math.PI) * f / 6.283, v * f / 2, o);

// ---------------------------------------------------------------- texture procedurali
function texSet(size, fn, opts = {}) {
  const W = size, H = opts.h || size;
  const col = new Uint8ClampedArray(W * H * 4), rough = new Uint8ClampedArray(W * H * 4), emi = new Uint8ClampedArray(W * H * 4);
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = fn(x / W, y / H), i = (y * W + x), k = i * 4;
    col[k] = r.c[0]; col[k + 1] = r.c[1]; col[k + 2] = r.c[2]; col[k + 3] = 255;
    const ro = (r.r ?? .7) * 255; rough[k] = rough[k + 1] = rough[k + 2] = ro; rough[k + 3] = 255;
    const e = r.e || [0, 0, 0]; emi[k] = e[0]; emi[k + 1] = e[1]; emi[k + 2] = e[2]; emi[k + 3] = 255;
    hgt[i] = r.h ?? 0;
  }
  const nrm = new Uint8ClampedArray(W * H * 4), st = opts.bump ?? 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = hgt[y * W + ((x - 1 + W) % W)], rr = hgt[y * W + ((x + 1) % W)], u = hgt[((y - 1 + H) % H) * W + x], d = hgt[((y + 1) % H) * W + x];
    let nx = (l - rr) * st, ny = (d - u) * st, nz = 1; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const k = (y * W + x) * 4; nrm[k] = (nx * .5 + .5) * 255; nrm[k + 1] = (ny * .5 + .5) * 255; nrm[k + 2] = (nz * .5 + .5) * 255; nrm[k + 3] = 255;
  }
  const mk = (data, srgb) => { const t = new THREE.DataTexture(data, W, H); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true; return t; };
  return { map: mk(col, true), roughnessMap: mk(rough), emissiveMap: opts.emissive ? mk(emi, true) : null, normalMap: mk(nrm) };
}
const hex = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sat = x => Math.max(0, Math.min(1, x));
function canvasTex(w, h, draw, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; return t; }
let SPRITE = null;
function spriteTex() { return SPRITE || (SPRITE = canvasTex(64, 64, (g, w) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); })); }

// ---------------------------------------------------------------- materiali: bordo luminoso, lampo e dissolvenza
const GLSL_NOISE = `
float h3(vec3 p){p=fract(p*0.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn3(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(h3(i+vec3(0,0,0)),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
function enhance(m, U, rim = {}) {
  m.userData.rimColor = new THREE.Color(rim.color ?? 0x000000);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = U.dissolve; sh.uniforms.uFlash = U.flash; sh.uniforms.uEdge = U.edge;
    sh.uniforms.uRim = { value: m.userData.rimColor }; sh.uniforms.uRimPow = { value: rim.pow ?? 3 }; sh.uniforms.uRimStr = { value: rim.str ?? 0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vObjPos; uniform float uDissolve; uniform float uFlash; uniform vec3 uEdge; uniform vec3 uRim; uniform float uRimPow; uniform float uRimStr;${GLSL_NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
float dn = vn3(vObjPos*7.0)*.6 + vn3(vObjPos*19.0)*.4;
if (dn < uDissolve) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float fres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), uRimPow);
totalEmissiveRadiance += uRim * fres * uRimStr + vec3(uFlash) * (0.6 + fres);
if (uDissolve > 0.001 && dn < uDissolve + 0.07) totalEmissiveRadiance += uEdge * 6.0;`);
  };
  m.customProgramCacheKey = () => 'tdo-enh';
  return m;
}

// ---------------------------------------------------------------- geometrie
function displaced(geo, amp, freq, seed = 0, oct = 4) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const n = v.clone().normalize();
    const d = fbm(v.x * freq + seed, v.y * freq, v.z * freq, oct) * amp; v.addScaledVector(n, d); p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals(); return geo;
}
// tubo rastremato con topologia fissa, aggiornabile ogni frame
function makeTube(nSeg, nRad) {
  const g = new THREE.BufferGeometry(); const count = (nSeg + 1) * (nRad + 1);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const uv = new Float32Array(count * 2); const idx = [];
  for (let i = 0; i <= nSeg; i++) for (let j = 0; j <= nRad; j++) { const k = i * (nRad + 1) + j; uv[k * 2] = i / nSeg; uv[k * 2 + 1] = j / nRad;
    if (i < nSeg && j < nRad) { const a = k, b = k + nRad + 1, c = b + 1, d = a + 1; idx.push(a, b, d, b, c, d); } }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.userData = { nSeg, nRad }; return g;
}
const _t = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function updateTube(g, pts, radius) {
  const { nSeg, nRad } = g.userData, pos = g.attributes.position.array, nor = g.attributes.normal.array;
  _n.set(1, 0, 0);
  for (let i = 0; i <= nSeg; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(nSeg, i + 1)]; _t.subVectors(b, a).normalize();
    if (i === 0) { _n.crossVectors(_t, Math.abs(_t.y) < .9 ? _up : _b.set(1, 0, 0)).normalize(); }
    else { _n.addScaledVector(_t, -_n.dot(_t)).normalize(); }
    _b.crossVectors(_t, _n); const r = radius(i / nSeg), c = pts[i];
    for (let j = 0; j <= nRad; j++) { const an = j / nRad * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an);
      const nx = _n.x * cs + _b.x * sn, ny = _n.y * cs + _b.y * sn, nz = _n.z * cs + _b.z * sn; const k = (i * (nRad + 1) + j) * 3;
      pos[k] = c.x + nx * r; pos[k + 1] = c.y + ny * r; pos[k + 2] = c.z + nz * r; nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz; }
  }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.computeBoundingSphere();
}
function staticTube(pts, radius, nRad = 12) { const g = makeTube(pts.length - 1, nRad); updateTube(g, pts, radius); return g; }
function curvePts(ctrl, n) { const c = new THREE.CatmullRomCurve3(ctrl); return c.getPoints(n); }
function mesh(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; }

// ---------------------------------------------------------------- particelle
function particles(n, color, size, blending = THREE.AdditiveBlending, opacity = .9) {
  const g = new THREE.BufferGeometry(); const p = new Float32Array(n * 3); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color, size, map: spriteTex(), transparent: true, depthWrite: false, blending, opacity, sizeAttenuation: true });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false;
  pts.userData.seed = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random(), Math.random()]); return pts;
}
function updRising(pts, t, R, H, speed, y0 = 0) {
  const a = pts.geometry.attributes.position.array, s = pts.userData.seed;
  for (let i = 0; i < s.length; i++) { const [r1, r2, r3, r4] = s[i]; const ph = (t * speed * (.6 + r3 * .8) + r1) % 1; const an = r2 * 6.283 + t * .3 * (r4 - .5);
    const rr = R * (.3 + .7 * r4) + Math.sin(t * 2 + i) * .05; a[i * 3] = Math.cos(an) * rr; a[i * 3 + 1] = y0 + ph * H; a[i * 3 + 2] = Math.sin(an) * rr; }
  pts.geometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- MOSTRI
function U() { return { dissolve: { value: 0 }, flash: { value: 0 }, edge: { value: new THREE.Color(PAL.ember) } }; }

function buildSpettro() {
  const u = U(); u.edge.value.set(PAL.spectral); const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const cloth = texSet(256, (x, y) => { const f = tn(x, y, 10, 4) * .5 + tn(x * 6 % 1, y * .15, 6, 2) * .5; const fold = Math.sin(x * 2 * Math.PI * 14 + tn(x, y, 3, 2) * 6) * .5 + .5;
    const c = mix(hex(0x9AA8C4), hex(0xF2F6FF), sat(.55 + f * .6 + fold * .25 - (1 - y) * .1)); return { c, r: .82, h: fold * .6 + f * .4 }; }, { bump: 3 });
  const alpha = canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(.75, '#ddd'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
  const robeMat = enhance(new THREE.MeshPhysicalMaterial({ ...cloth, emissiveMap: null, color: 0xffffff, alphaMap: alpha, transparent: true, side: THREE.DoubleSide,
    emissive: PAL.spectral, emissiveIntensity: .06, sheen: 1, sheenColor: new THREE.Color(0xBFE8FF), sheenRoughness: .6 }), u, { color: PAL.spectral, pow: 2.2, str: 1.6 });
  // veste: profilo tornito con orlo stracciato
  const prof = []; for (let i = 0; i <= 30; i++) { const y = i / 30 * 1.75; const r = .62 - .28 * Math.pow(i / 30, .8) + .04 * Math.sin(i * .9); prof.push(new THREE.Vector2(r, y)); }
  const robeG = new THREE.LatheGeometry(prof, 56); const P = robeG.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); const an = Math.atan2(z, x);
    if (y < .55) { const tear = Math.max(0, Math.sin(an * 9 + 1.3) * .5 + Math.sin(an * 23) * .3 + .2) * (.55 - y) * 1.6; P.setY(i, y + tear); } }
  robeG.computeVertexNormals(); robeG.userData.base = Float32Array.from(P.array);
  const robe = mesh(robeG, robeMat); body.add(robe);
  // cappuccio
  const hoodG = new THREE.SphereGeometry(.34, 48, 32, Math.PI * .62, Math.PI * 1.76, 0, Math.PI * .66);
  const hood = mesh(hoodG, robeMat); hood.position.set(0, 1.86, -.02); hood.scale.set(1, 1.28, 1.12); body.add(hood);
  const face = new THREE.Mesh(new THREE.SphereGeometry(.24, 24, 16), new THREE.MeshBasicMaterial({ color: 0x010204 })); face.position.set(0, 1.84, .05); face.scale.set(1, 1.2, .8); body.add(face);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9FF6FF, emissiveIntensity: 9 });
  const eyes = []; for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.026, 12, 8), eyeM); e.position.set(s * .085, 1.88, .2); body.add(e); eyes.push(e); }
  const glow = new THREE.PointLight(PAL.spectral, 2.2, 3.5, 1.6); glow.position.set(0, 1.85, .45); body.add(glow);
  // braccia (maniche) e mani ossute
  const boneM = enhance(new THREE.MeshStandardMaterial({ color: 0xD8D2C6, roughness: .55 }), u);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * .3, 1.55, 0); body.add(arm);
    const sleeve = mesh(staticTube(curvePts([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * .25, -.15, .15), new THREE.Vector3(s * .32, -.42, .38)], 10), t => .07 + .06 * t), robeMat); arm.add(sleeve);
    const hand = new THREE.Group(); hand.position.set(s * .32, -.46, .4); arm.add(hand);
    const palm = mesh(new THREE.SphereGeometry(.05, 12, 8), boneM); palm.scale.set(1, .7, 1.2); hand.add(palm);
    const fingers = [];
    for (let f = 0; f < 4; f++) { const fg = new THREE.Group(); fg.position.set((f - 1.5) * .025, -.02, .04); fg.rotation.x = .4; hand.add(fg);
      const a = mesh(new THREE.CapsuleGeometry(.011, .09, 4, 8), boneM); a.position.y = -.06; fg.add(a);
      const b = new THREE.Group(); b.position.y = -.12; fg.add(b); const c = mesh(new THREE.CapsuleGeometry(.009, .08, 4, 8), boneM); c.position.y = -.05; b.add(c); fingers.push([fg, b]); }
    arms.push({ arm, hand, fingers, s });
  }
  const motes = particles(40, PAL.spectral, .05); root.add(motes);
  const wisps = particles(24, 0xDDEBFF, .35, THREE.NormalBlending, .12); root.add(wisps);
  return { root, body, u, hover: .35, height: 2.2, center: 1.2, radius: .75, lights: [glow],
    update(t, dt, st) {
      body.position.y = this.hover + Math.sin(t * 1.3) * .08 + st.lunge * .1; body.rotation.z = Math.sin(t * .7) * .04; body.rotation.x = -st.wind * .25 + st.lunge * .3;
      const a = robeG.attributes.position.array, b0 = robeG.userData.base;
      for (let i = 0; i < a.length; i += 3) { const y = b0[i + 1], k = Math.pow(1 - y / 1.9, 2); const an = Math.atan2(b0[i + 2], b0[i]);
        a[i] = b0[i] + Math.sin(t * 2.2 + y * 3 + an * 3) * .05 * k; a[i + 2] = b0[i + 2] + Math.cos(t * 1.8 + y * 2.5 + an * 4) * .05 * k - .06 * k * Math.sin(t * .9); }
      robeG.attributes.position.needsUpdate = true; robeG.computeVertexNormals();
      for (const A of arms) { A.arm.rotation.z = A.s * (.2 + Math.sin(t * 1.1 + A.s) * .1) - A.s * st.wind * .5; A.arm.rotation.x = -.2 - st.wind * .6 - st.lunge * 1.2;
        A.fingers.forEach(([f, b], i) => { const c = .3 + .3 * Math.sin(t * 2 + i * .7) + st.wind * .5; f.rotation.x = .3 + c; b.rotation.x = c * .8; }); }
      const bl = Math.sin(t * .9) > .985 ? .1 : 1; eyes.forEach(e => e.scale.set(1, bl, 1)); eyeM.emissiveIntensity = 9 + st.wind * 15;
      glow.intensity = 2 + Math.sin(t * 6) * .3 + st.wind * 3;
      updRising(motes, t, .8, 2.6, .12, .2); updRising(wisps, t, .45, .9, .2, .2);
    } };
}

function buildRagno() {
  const u = U(); u.edge.value.set(0xFF3020); const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const chit = texSet(256, (x, y) => { const n = tn(x, y, 12, 4); const sp = sat((tn(x, y, 40, 2) - .15) * 3);
    let c = mix(hex(0x0E0B12), hex(0x2C2434), sat(.5 + n));
    const dx = (x - .25) * 2.2, dy = (y - .62) * 1.6; const sk = Math.hypot(dx, dy * 1.1);
    let red = 0; if (sk < .16) red = 1; if (Math.abs(dx) < .1 && dy < -.08 && dy > -.24) red = 1;
    if (Math.hypot(dx - .055, dy - .02) < .05 || Math.hypot(dx + .055, dy - .02) < .05) red = 0; if (dy < -.15 && Math.abs(dx) < .1 && Math.floor((dx + .1) * 50) % 2 === 0) red = 0;
    if (red) c = mix(hex(0x8A0E12), hex(0xC8262E), sat(.6 + n));
    return { c, r: red ? .45 : .28 + sp * .3, h: n * .4 + sp * .2 }; }, { bump: 2.5 });
  const chitin = enhance(new THREE.MeshPhysicalMaterial({ ...chit, clearcoat: 1, clearcoatRoughness: .18, sheen: .6, sheenColor: new THREE.Color(0x5A2A6A), envMapIntensity: 1.2 }), u, { color: 0x6A1020, pow: 4, str: .6 });
  const legM = enhance(new THREE.MeshPhysicalMaterial({ color: 0x17131C, roughness: .4, clearcoat: .8, clearcoatRoughness: .3, normalMap: chit.normalMap }), u);
  const abdG = displaced(new THREE.SphereGeometry(1, 64, 48), .025, 3, 4);
  const abd = mesh(abdG, chitin); abd.scale.set(.58, .5, .72); abd.position.set(0, .82, -.55); abd.rotation.x = -.55; body.add(abd);
  // peli
  const hairG = new THREE.ConeGeometry(.007, .07, 4); hairG.translate(0, .035, 0);
  const hair = new THREE.InstancedMesh(hairG, new THREE.MeshStandardMaterial({ color: 0x0C0A0E, roughness: .9 }), 900); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 900; i++) { v.randomDirection(); if (v.z > .35 && v.y > .2) v.y -= .5; v.normalize(); const p = v.clone().multiply(new THREE.Vector3(.58, .5, .72)); const nrm = v.clone().divide(new THREE.Vector3(.58, .5, .72)).normalize();
    nrm.add(new THREE.Vector3((Math.random() - .5) * .6, (Math.random() - .5) * .6, -.4)).normalize(); q.setFromUnitVectors(up, nrm); m4.compose(p, q, new THREE.Vector3(1, .6 + Math.random() * .9, 1)); hair.setMatrixAt(i, m4); }
  const hairG2 = new THREE.Group(); hairG2.add(hair); hairG2.position.copy(abd.position); hairG2.rotation.copy(abd.rotation); body.add(hairG2);
  const head = mesh(displaced(new THREE.SphereGeometry(1, 48, 32), .02, 4, 9), chitin); head.scale.set(.36, .28, .4); head.position.set(0, .66, .22); body.add(head);
  const eyeM = new THREE.MeshPhysicalMaterial({ color: 0x050000, emissive: 0xFF1A10, emissiveIntensity: 2.2, clearcoat: 1, clearcoatRoughness: .02, roughness: .1 });
  [[-.08, .8, .52, .055], [.08, .8, .52, .055], [-.17, .76, .48, .036], [.17, .76, .48, .036], [-.12, .88, .44, .03], [.12, .88, .44, .03], [-.04, .71, .58, .026], [.04, .71, .58, .026]]
    .forEach(([x, y, z, r]) => { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), eyeM); e.position.set(x, y, z); body.add(e); });
  const red = new THREE.PointLight(0xFF2010, 1.2, 1.6, 2); red.position.set(0, .82, .8); body.add(red);
  const fangM = enhance(new THREE.MeshPhysicalMaterial({ color: 0x2A2228, roughness: .3, clearcoat: 1 }), u);
  const tipM = enhance(new THREE.MeshStandardMaterial({ color: 0xE6DCC8, roughness: .35 }), u);
  const fangs = [];
  for (const s of [-1, 1]) { const f = new THREE.Group(); f.position.set(s * .07, .58, .5); body.add(f);
    const a = mesh(staticTube(curvePts([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * .02, -.1, .06), new THREE.Vector3(-s * .02, -.2, .02)], 12), t => .035 * (1 - t) + .004), fangM); f.add(a);
    const tip = mesh(new THREE.ConeGeometry(.012, .07, 8), tipM); tip.position.set(-s * .02, -.23, .02); tip.rotation.x = Math.PI; f.add(tip); fangs.push(f); }
  const venom = new THREE.Mesh(new THREE.SphereGeometry(.014, 10, 8), new THREE.MeshStandardMaterial({ color: 0x40FF40, emissive: 0x60FF30, emissiveIntensity: 2.5, roughness: .1 })); body.add(venom);
  // zampe a tre segmenti
  const legs = [];
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const hip = new THREE.Group(); hip.position.set(s * .2, .66, .32 - i * .14); body.add(hip);
    const base = s > 0 ? -(.7 - i * .45) : Math.PI + (.7 - i * .45);
    const fem = new THREE.Group(); hip.add(fem); const femM = mesh(new THREE.CapsuleGeometry(.045, .62, 6, 10), legM); femM.rotation.z = Math.PI / 2; femM.position.x = .33; fem.add(femM);
    const knee = new THREE.Group(); knee.position.x = .66; fem.add(knee); const kn = mesh(new THREE.SphereGeometry(.055, 12, 10), chitin); knee.add(kn);
    const tib = mesh(new THREE.CapsuleGeometry(.036, .74, 6, 10), legM); tib.rotation.z = Math.PI / 2; tib.position.x = .38; knee.add(tib);
    const ank = new THREE.Group(); ank.position.x = .76; knee.add(ank); const tar = mesh(new THREE.CapsuleGeometry(.024, .32, 4, 8), legM); tar.rotation.z = Math.PI / 2; tar.position.x = .17; ank.add(tar);
    legs.push({ hip, fem, knee, ank, base, s, ph: i * 1.6 + (s > 0 ? .8 : 0) });
  }
  const silk = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, 30, 4), new THREE.MeshBasicMaterial({ color: 0xE8E8F0, transparent: true, opacity: .45 })); silk.position.set(0, 15.8, -.6); body.add(silk);
  return { root, body, u, hover: 0, height: 1.4, center: .7, radius: 1.0, lights: [red], drop: 0,
    update(t, dt, st) {
      if (this.drop < 1) this.drop = Math.min(1, this.drop + dt * .55); const dr = 1 - Math.pow(1 - this.drop, 3);
      silk.material.opacity = .45 * (1 - Math.max(0, this.drop - .8) * 5);
      body.position.y = (1 - dr) * 4 + Math.sin(t * 3) * .015 + st.lunge * .15; body.position.z = st.lunge * .7; body.rotation.x = -st.wind * .3;
      abd.scale.set(.58 * (1 + Math.sin(t * 2) * .015), .5, .72);
      const walk = .4 + st.wind * .8 + (1 - dr) * .2;
      legs.forEach(L => { const w = Math.sin(t * 7 * walk + L.ph); L.hip.rotation.y = L.base + w * .12;
        L.fem.rotation.z = .85 + Math.max(0, w) * .25 + st.wind * .3 * (L.ph % 2 > 1 ? 1 : 0);
        L.knee.rotation.z = -2.05 - Math.max(0, -w) * .1; L.ank.rotation.z = -.6; });
      fangs.forEach((f, i) => f.rotation.z = (i ? -1 : 1) * (Math.sin(t * 5) * .08 + st.wind * .35));
      const dp = (t * .5) % 1; venom.position.set(-.05, .35 - dp * dp * .35, .52); venom.scale.setScalar(dp < .9 ? 1 : (1 - dp) * 10);
      red.intensity = 1.2 + st.wind * 4;
    } };
}

function buildDemone() {
  const u = U(); const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = texSet(256, (x, y) => { const n = tn(x, y, 8, 5), cr = cracks(x, y, 7, 3), cr2 = cracks(x, y, 15, 8);
    const crk = sat(1 - cr / .035) * .9 + sat(1 - cr2 / .02) * .4; const base = mix(hex(0x5A0E0A), hex(0xB33A20), sat(.5 + n * 1.2));
    const c = mix(base, hex(0x1A0402), sat(crk)); const glow = sat(crk) * (.6 + .4 * sat(.5 + tn(x, y, 4, 2)));
    return { c, r: .55 + n * .2 - crk * .2, h: n * .5 - crk * .6, e: mix([0, 0, 0], [255, 120, 20], glow) }; }, { emissive: true, bump: 4 });
  const skinM = enhance(new THREE.MeshPhysicalMaterial({ ...skin, emissive: 0xffffff, emissiveIntensity: 1.3, sheen: .4, sheenColor: new THREE.Color(0xFF6A30) }), u, { color: 0xFF5A10, pow: 3, str: .5 });
  const horn = texSet(64, (x, y) => { const r = Math.sin(x * 60) * .5 + .5; const c = mix(mix(hex(0x1A120C), hex(0x3A2A1E), r * .5), hex(0xE8DCC0), Math.pow(x, 3)); return { c, r: .45, h: r }; }, { bump: 3 });
  const hornM = enhance(new THREE.MeshPhysicalMaterial({ ...horn, clearcoat: .6 }), u);
  const clawM = enhance(new THREE.MeshPhysicalMaterial({ color: 0xEDE2CC, roughness: .3, clearcoat: .6 }), u);
  const part = (geo, x, y, z, sx, sy, sz, par = body) => { const m = mesh(geo, skinM); m.position.set(x, y, z); m.scale.set(sx, sy, sz); par.add(m); return m; };
  const blob = s => displaced(new THREE.SphereGeometry(1, 40, 28), .06, 3, s);
  part(blob(1), 0, 1.38, 0, .44, .5, .3); part(blob(2), -.16, 1.55, .12, .2, .17, .16); part(blob(3), .16, 1.55, .12, .2, .17, .16);
  part(blob(4), 0, .98, 0, .3, .22, .24); part(blob(5), 0, 1.86, .02, .12, .13, .12);
  const head = new THREE.Group(); head.position.set(0, 2.05, .05); body.add(head);
  part(blob(6), 0, 0, 0, .19, .22, .2, head); part(blob(7), 0, -.12, .07, .14, .1, .13, head);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xFFD02A, emissiveIntensity: 10 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.03, 12, 8), eyeM); e.position.set(s * .075, .03, .17); e.scale.set(1.3, .6, .6); e.rotation.z = s * .3; head.add(e);
    const hp = curvePts([new THREE.Vector3(s * .1, .12, 0), new THREE.Vector3(s * .28, .22, -.05), new THREE.Vector3(s * .34, .45, -.12), new THREE.Vector3(s * .26, .62, -.2)], 24);
    head.add(mesh(staticTube(hp, t => .065 * (1 - t) + .004), hornM)); }
  const mouthM = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xFF6A10, emissiveIntensity: 2 }); const mouth = new THREE.Mesh(new THREE.SphereGeometry(.07, 16, 8), mouthM); mouth.position.set(0, -.1, .18); mouth.scale.set(1, .35, .4); head.add(mouth);
  const limb = (pts, r0, r1, par) => { const m = mesh(staticTube(curvePts(pts, 16), t => lerp(r0, r1, t)), skinM); par.add(m); return m; };
  const arms = [];
  for (const s of [-1, 1]) { const sh = new THREE.Group(); sh.position.set(s * .4, 1.6, 0); body.add(sh); part(blob(10 + s), 0, 0, 0, .14, .14, .14, sh);
    limb([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * .12, -.25, .04), new THREE.Vector3(s * .18, -.5, .1)], .1, .07, sh);
    const el = new THREE.Group(); el.position.set(s * .18, -.5, .1); sh.add(el);
    limb([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * .04, -.22, .12), new THREE.Vector3(s * .05, -.42, .2)], .07, .05, el);
    const hand = new THREE.Group(); hand.position.set(s * .05, -.45, .2); el.add(hand); part(blob(20 + s), 0, 0, 0, .07, .06, .05, hand);
    for (let k = 0; k < 4; k++) { const c = mesh(new THREE.ConeGeometry(.012, .1, 8), clawM); c.position.set((k - 1.5) * .025, -.07, .03); c.rotation.x = Math.PI + .5; hand.add(c); }
    arms.push({ sh, el, s }); }
  for (const s of [-1, 1]) { const hp = new THREE.Group(); hp.position.set(s * .17, .92, 0); body.add(hp);
    limb([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * .05, -.25, .16), new THREE.Vector3(s * .07, -.48, .12)], .11, .07, hp);
    limb([new THREE.Vector3(s * .07, -.48, .12), new THREE.Vector3(s * .08, -.68, -.06), new THREE.Vector3(s * .08, -.9, .02)], .065, .045, hp);
    const hoof = mesh(new THREE.CylinderGeometry(.04, .07, .08, 12), hornM); hoof.position.set(s * .08, -.9, .04); hp.add(hoof); }
  // ali con membrana
  const wingTex = texSet(128, (x, y) => { const v = Math.abs(Math.sin(x * 40 + tn(x, y, 6, 2) * 4)); const n = tn(x, y, 10, 3); return { c: mix(hex(0x2A0306), hex(0x7A1414), sat(.5 + n - v * .3)), r: .6, h: n - v * .3 }; }, { bump: 2 });
  const wingM = enhance(new THREE.MeshPhysicalMaterial({ ...wingTex, side: THREE.DoubleSide, transparent: true, opacity: .96, sheen: .5, sheenColor: new THREE.Color(0xFF4020) }), u, { color: 0xFF3010, pow: 2, str: .35 });
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(s * .18, 1.62, -.22); body.add(w);
    const tips = [[s * 1.35, .95, -.25], [s * 1.55, .2, -.3], [s * 1.2, -.35, -.25], [s * .7, -.6, -.15]];
    const elbow = [s * .65, .55, -.15]; const pos = []; const uv = [];
    const add = (a, b, c) => { pos.push(...a, ...b, ...c); uv.push(.5, .5, (b[0] * s) / 1.6, (b[1] + .7) / 1.7, (c[0] * s) / 1.6, (c[1] + .7) / 1.7); };
    const O = [0, 0, 0]; add(O, elbow, tips[0]);
    for (let i = 0; i < tips.length - 1; i++) { const a = tips[i], b = tips[i + 1]; const mid = [(a[0] + b[0]) / 2 * .78, (a[1] + b[1]) / 2 * .78, (a[2] + b[2]) / 2];
      add(elbow, a, mid); add(elbow, mid, b); }
    add(elbow, tips[3], O);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    w.add(mesh(g, wingM));
    const bone = (a, b, r) => w.add(mesh(staticTube([new THREE.Vector3(...a), new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), .5).add(new THREE.Vector3(0, .05, 0)), new THREE.Vector3(...b)], t => r * (1 - t * .6), 8), skinM));
    bone(O, elbow, .045); tips.forEach(tp => bone(elbow, tp, .025));
    const cl = mesh(new THREE.ConeGeometry(.02, .1, 8), clawM); cl.position.set(...elbow); cl.position.y += .06; w.add(cl);
    wings.push({ w, s });
  }
  const tail = makeTube(24, 10); const tailM = mesh(tail, skinM); body.add(tailM); const tailTip = mesh(new THREE.ConeGeometry(.05, .14, 4), hornM); body.add(tailTip);
  const fire = new THREE.PointLight(0xFF6A20, 3, 4, 1.6); fire.position.set(0, 1.4, .5); body.add(fire);
  const embers = particles(70, 0xFF8A30, .045); root.add(embers);
  const heat = particles(18, 0xFF4A10, .5, THREE.AdditiveBlending, .12); root.add(heat);
  const tp = Array.from({ length: 25 }, () => new THREE.Vector3());
  return { root, body, u, hover: 0, height: 2.7, center: 1.35, radius: .9, lights: [fire],
    update(t, dt, st) {
      body.position.y = .02 + Math.sin(t * 1.6) * .02; body.position.z = st.lunge * .8; body.rotation.x = -st.wind * .2 + st.lunge * .25;
      head.rotation.y = Math.sin(t * .6) * .25; head.rotation.x = -st.wind * .3;
      arms.forEach(A => { A.sh.rotation.z = A.s * (.25 + Math.sin(t * 1.2 + A.s) * .1 + st.wind * .5); A.sh.rotation.x = -.2 - st.wind * 1.2 - st.lunge * 1.5; A.el.rotation.x = -.4 - st.wind * .6; });
      const flap = Math.sin(t * (2.2 + st.wind * 4)) * .45; wings.forEach(W => { W.w.rotation.y = W.s * (-.5 + flap * .6); W.w.rotation.z = W.s * flap * .25; });
      for (let i = 0; i <= 24; i++) { const k = i / 24; tp[i].set(Math.sin(t * 1.4 + k * 3) * .25 * k, .95 - k * .7 + Math.sin(k * 3.2) * .25 * k, -.22 - k * 1.05); }
      updateTube(tail, tp, k => .07 * (1 - k) + .012); tailTip.position.copy(tp[24]); tailTip.lookAt(tp[24].clone().add(tp[24].clone().sub(tp[23]))); tailTip.rotateX(Math.PI / 2);
      skinM.emissiveIntensity = 1.1 + Math.sin(t * 3) * .3 + st.wind * 2.5; fire.intensity = 2.8 + Math.sin(t * 17) * .4 + Math.sin(t * 7.3) * .4 + st.wind * 3;
      eyeM.emissiveIntensity = 10 + st.wind * 10; mouthM.emissiveIntensity = 2 + st.wind * 4;
      updRising(embers, t, .9, 3.2, .25, .2); updRising(heat, t, .5, 2.2, .35, .6);
    } };
}

function buildGolem() {
  const u = U(); const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const st = texSet(256, (x, y) => { const n = tn(x, y, 9, 5), m = tn(x + .3, y, 4, 3), cr = cracks(x, y, 6, 11);
    let c = mix(hex(0x3E3C42), hex(0x9C99A2), sat(.5 + n * 1.3)); if (m > .12) c = mix(c, hex(0x4E6A3A), sat((m - .12) * 4) * .85);
    const crk = sat(1 - cr / .045); c = mix(c, hex(0x120A06), crk);
    return { c, r: .92, h: n - crk * .8, e: mix([0, 0, 0], [255, 130, 30], crk * sat(.4 + tn(x, y, 3, 2) * 2)) }; }, { emissive: true, bump: 5 });
  const stoneM = enhance(new THREE.MeshStandardMaterial({ ...st, emissive: 0xffffff, emissiveIntensity: 2.4, flatShading: true, envMapIntensity: .5 }), u, { color: 0xFF7A20, pow: 4, str: .2 });
  const rock = (r, seed, x, y, z, sx = 1, sy = 1, sz = 1, par = body) => { const m = mesh(displaced(new THREE.IcosahedronGeometry(r, 2), r * .34, 1.4 / r, seed, 3), stoneM); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(seed, seed * 2, seed * 3); par.add(m); return m; };
  rock(.62, 1, 0, 1.5, 0, 1.05, .95, .7); rock(.32, 2, -.22, 1.62, .32, 1, .9, .6); rock(.32, 3, .22, 1.6, .32, 1, .9, .6); rock(.42, 4, 0, .98, .05, 1, .7, .8);
  const head = new THREE.Group(); head.position.set(0, 2.32, .15); body.add(head); rock(.3, 5, 0, 0, 0, 1, .85, .9, head); rock(.2, 6, 0, .1, .15, 1.6, .45, .7, head);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xFFA030, emissiveIntensity: 9 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(.09, .03, .03), eyeM); e.position.set(s * .1, .02, .27); e.rotation.z = s * -.2; head.add(e); }
  const runeM = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xFF8A20, emissiveIntensity: 6 });
  const rune = new THREE.Group(); rune.position.set(0, 1.55, .5); body.add(rune);
  rune.add(new THREE.Mesh(new THREE.TorusGeometry(.1, .012, 8, 32), runeM)); const b1 = new THREE.Mesh(new THREE.BoxGeometry(.018, .26, .018), runeM); rune.add(b1); const b2 = new THREE.Mesh(new THREE.BoxGeometry(.018, .2, .018), runeM); b2.rotation.z = .9; rune.add(b2);
  const arms = [];
  for (const s of [-1, 1]) { const sh = new THREE.Group(); sh.position.set(s * .7, 1.82, 0); body.add(sh); rock(.34, 7 + s, 0, 0, 0, 1.1, .9, 1, sh);
    rock(.22, 9 + s, s * .1, -.38, .05, .9, 1.3, .9, sh); const fa = new THREE.Group(); fa.position.set(s * .12, -.72, .1); sh.add(fa); rock(.2, 11 + s, 0, 0, 0, .9, 1.3, .9, fa); rock(.36, 13 + s, s * .02, -.45, .08, 1, .95, 1, fa); arms.push({ sh, fa, s }); }
  for (const s of [-1, 1]) { rock(.26, 15 + s, s * .3, .55, 0, 1, 1.2, 1); rock(.27, 17 + s, s * .32, .18, .06, 1.1, .7, 1.2); }
  const peb = []; for (let i = 0; i < 9; i++) { const p = rock(.06 + Math.random() * .05, 20 + i, 0, 0, 0, 1, 1, 1, root); peb.push(p); }
  const core = new THREE.PointLight(0xFF7A20, 2.6, 3.5, 1.6); core.position.set(0, 1.5, .8); body.add(core);
  const dust = particles(40, 0x9A948A, .12, THREE.NormalBlending, .25); root.add(dust);
  return { root, body, u, hover: 0, height: 2.8, center: 1.4, radius: 1.0, lights: [core],
    update(t, dt, s2) {
      const br = Math.sin(t * .9); body.position.y = br * .02; body.rotation.z = Math.sin(t * .6) * .03; body.position.z = s2.lunge * .9; body.rotation.x = -s2.wind * .15 + s2.lunge * .3;
      head.rotation.y = Math.sin(t * .4) * .2;
      arms.forEach(A => { A.sh.rotation.z = A.s * (.08 + Math.sin(t * .9 + A.s) * .05); A.sh.rotation.x = -s2.wind * 1.4 - s2.lunge * 1.6; A.fa.rotation.x = -.15 - s2.wind * .5; });
      peb.forEach((p, i) => { const a = t * .5 + i * .7, r = 1.3 + (i % 3) * .2; p.position.set(Math.cos(a) * r, 1.2 + Math.sin(t + i) * .4 + (i % 2) * .5, Math.sin(a) * r); p.rotation.x += dt * .5; p.rotation.y += dt * .7; });
      const pul = .5 + .5 * Math.sin(t * 2.4); stoneM.emissiveIntensity = 1.6 + pul * 1.6 + s2.wind * 3; runeM.emissiveIntensity = 4 + pul * 6 + s2.wind * 10; core.intensity = 2 + pul * 1.5 + s2.wind * 4;
      eyeM.emissiveIntensity = 9 + s2.wind * 12; updRising(dust, t, 1.2, .8, .08, 0);
    } };
}

function buildBoss() {
  const u = U(); u.edge.value.set(0xC040FF); const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const flesh = texSet(256, (x, y) => { const n = tn(x, y, 7, 5), cr = cracks(x, y, 9, 21), crk = sat(1 - cr / .05);
    const c = mix(mix(hex(0x14031A), hex(0x5A1A63), sat(.45 + n * 1.2)), hex(0x8A1030), crk * .6);
    return { c, r: .35 + n * .2, h: n + crk * .4, e: mix([0, 0, 0], [255, 40, 120], crk * sat(.3 + tn(x, y, 3, 2) * 2)) }; }, { emissive: true, bump: 3 });
  const fleshM = enhance(new THREE.MeshPhysicalMaterial({ ...flesh, emissive: 0xffffff, emissiveIntensity: 1.2, clearcoat: .7, clearcoatRoughness: .25, sheen: .6, sheenColor: new THREE.Color(0xC060FF) }), u, { color: 0xA040FF, pow: 2.5, str: .6 });
  const coreG = displaced(new THREE.SphereGeometry(1.2, 72, 56), .1, 1.3, 31); const core = mesh(coreG, fleshM); body.add(core);
  // occhi
  const eyeTex = canvasTex(512, 256, (g, w, h) => { g.fillStyle = '#E8DCC8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(190,20,30,.55)'; for (let i = 0; i < 60; i++) { g.lineWidth = Math.random() * 1.6 + .3; g.beginPath(); let x = Math.random() * w, y = Math.random() < .5 ? 0 : h; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (Math.random() - .5) * 30 + (w * .25 - x) * .08; y += (h / 2 - y) * .22 + (Math.random() - .5) * 14; g.lineTo(x, y); } g.stroke(); }
    const cx = w * .25, cy = h / 2; let r = g.createRadialGradient(cx, cy, 2, cx, cy, 50); r.addColorStop(0, '#FFE070'); r.addColorStop(.35, '#FF8A10'); r.addColorStop(.8, '#B01010'); r.addColorStop(1, '#2A0000');
    g.fillStyle = r; g.beginPath(); g.arc(cx, cy, 48, 0, 7); g.fill(); g.strokeStyle = 'rgba(60,0,0,.5)'; g.lineWidth = 1; for (let i = 0; i < 40; i++) { const a = i / 40 * 6.283; g.beginPath(); g.moveTo(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14); g.lineTo(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46); g.stroke(); }
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(cx, cy, 6, 30, 0, 0, 7); g.fill(); });
  const eyeM = enhance(new THREE.MeshPhysicalMaterial({ map: eyeTex, roughness: .12, clearcoat: 1, clearcoatRoughness: .02, emissive: 0xFF3010, emissiveMap: eyeTex, emissiveIntensity: .25 }), u);
  const eyes = []; const ED = [[0, .45, 1, .3], [-.5, .3, .85, .2], [.5, .3, .85, .2], [-.3, .78, .75, .14], [.33, .8, .72, .15], [-.82, -.05, .65, .14], [.84, -.02, .62, .13], [0, .1, 1.1, .18], [-.38, -.08, 1.0, .11], [.4, -.06, .98, .11]];
  ED.forEach(([x, y, z, r], i) => { const d = new THREE.Vector3(x, y, z).normalize(); const g = new THREE.Group(); g.position.copy(d.multiplyScalar(1.16)); body.add(g);
    const lid = mesh(new THREE.SphereGeometry(r * 1.18, 24, 16), fleshM); lid.scale.z = .6; lid.lookAt(g.position.clone().multiplyScalar(2)); g.add(lid);
    const e = mesh(new THREE.SphereGeometry(r, 32, 24), eyeM, false); e.position.copy(new THREE.Vector3(x, y, z).normalize().multiplyScalar(r * .45)); g.add(e); eyes.push({ e, ph: i * 1.7 }); });
  // fauci
  const maw = new THREE.Group(); maw.position.set(0, -.5, .95); maw.rotation.x = .35; body.add(maw);
  const throatT = canvasTex(256, 128, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); r.addColorStop(0, '#FFB040'); r.addColorStop(.25, '#C02000'); r.addColorStop(.6, '#300000'); r.addColorStop(1, '#000'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const throatM = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: throatT, emissiveIntensity: 1.2, roughness: .6 });
  const throat = new THREE.Mesh(new THREE.SphereGeometry(.5, 32, 16), throatM); throat.scale.set(1.2, .5, .5); maw.add(throat);
  const lip = mesh(new THREE.TorusGeometry(.6, .1, 16, 48), fleshM); lip.scale.set(1, .48, 1); maw.add(lip);
  const toothM = enhance(new THREE.MeshPhysicalMaterial({ color: 0xF2EADA, roughness: .25, clearcoat: .8 }), u);
  for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; const tth = mesh(new THREE.ConeGeometry(.045, .2 + (i % 2) * .08, 8), toothM); tth.position.set(Math.cos(a) * .55, Math.sin(a) * .26, .05);
    tth.rotation.z = a + Math.PI / 2; maw.add(tth); }
  // corona di spine
  const spikeM = enhance(new THREE.MeshPhysicalMaterial({ color: 0xD8CCB4, roughness: .35, clearcoat: .5 }), u);
  for (let i = 0; i < 9; i++) { const a = (i - 4) * .3; const sp = mesh(new THREE.ConeGeometry(.08, .6 + (i % 2 ? 0 : .3), 10), spikeM); const d = new THREE.Vector3(Math.sin(a), Math.cos(a), -.25).normalize();
    sp.position.copy(d.clone().multiplyScalar(1.22)); sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); body.add(sp); }
  // tentacoli
  const tentTex = texSet(128, (x, y) => { const n = tn(y, x, 6, 3); const s1 = Math.abs(y - .25) < .12 && (Math.sin(x * 120) > .2); return { c: s1 ? mix(hex(0xD08AE0), hex(0xF2C8F8), n + .5) : mix(hex(0x1C0622), hex(0x5A1A63), sat(.5 + n)), r: s1 ? .4 : .5, h: s1 ? .5 : n }; }, { bump: 3 });
  const tentM = enhance(new THREE.MeshPhysicalMaterial({ ...tentTex, clearcoat: .5, clearcoatRoughness: .35, envMapIntensity: .5, sheen: .3, sheenColor: new THREE.Color(0x6A2080) }), u, { color: 0x8030C0, pow: 2.5, str: .5 });
  const tents = []; for (let i = 0; i < 10; i++) { const g = makeTube(32, 12); const m = mesh(g, tentM); body.add(m);
    const a = i / 10 * Math.PI * 2 + .3; tents.push({ g, a, pts: Array.from({ length: 33 }, () => new THREE.Vector3()), len: 2.2 + (i % 3) * .5, ph: i * 1.3 }); }
  const glow = new THREE.PointLight(0xA040FF, 3, 6, 1.4); glow.position.set(0, 0, 1.8); body.add(glow);
  const mawL = new THREE.PointLight(0xFF5A10, 2, 2.5, 2); mawL.position.set(0, -.5, 1.5); body.add(mawL);
  const motes = particles(80, 0xB060FF, .07); root.add(motes);
  const tmp = new THREE.Vector3(), camW = new THREE.Vector3();
  return { root, body, u, hover: 2.3, height: 4.8, center: 2.3, radius: 2.0, lights: [glow, mawL], scaleDist: 1.6,
    update(t, dt, st) {
      const rage = st.phase > 1; body.position.y = this.hover + Math.sin(t * .9) * .15; body.position.z = st.lunge * 1.2; body.rotation.x = -st.wind * .2;
      const br = 1 + Math.sin(t * (rage ? 3 : 1.8)) * .025; core.scale.set(br, br * .98, br);
      fleshM.emissiveIntensity = (rage ? 2.4 : 1.1) + Math.sin(t * 3) * .4 + st.wind * 2; throatM.emissiveIntensity = (rage ? 2.2 : 1.1) + st.wind * 2.5;
      glow.color.set(rage ? 0xFF2040 : 0xA040FF); motes.material.color.set(rage ? 0xFF4030 : 0xB060FF); u.edge.value.set(rage ? 0xFF3020 : 0xC040FF);
      maw.scale.y = 1 + Math.sin(t * 1.4) * .15 + st.wind * .5;
      st.camera.getWorldPosition(camW);
      eyes.forEach(E => { const bl = Math.sin(t * .8 + E.ph) > .975 ? .08 : 1; E.e.scale.set(1, bl, 1); E.e.lookAt(camW.x + Math.sin(t + E.ph) * .3, camW.y, camW.z); });
      tents.forEach(T => { const sp = rage ? 1.8 : 1;
        for (let i = 0; i <= 32; i++) { const k = i / 32, a = T.a + Math.sin(t * .9 * sp + T.ph + k * 3) * .5 * k;
          const r = 1.0 + k * T.len; const y = Math.sin(T.a) * r * .55 - k * k * 1.2 + Math.sin(t * 1.3 * sp + T.ph + k * 5) * .25 * k;
          T.pts[i].set(Math.cos(a) * r, y, -.3 + Math.cos(t * .7 + T.ph + k * 4) * .5 * k - k * .4); }
        updateTube(T.g, T.pts, k => .2 * (1 - k) + .02); });
      updRising(motes, t, 2.4, 5, .1, -.5);
    } };
}
const BUILDERS = { spettro: buildSpettro, ragno: buildRagno, demone: buildDemone, golem: buildGolem, boss: buildBoss };

// ---------------------------------------------------------------- scena AR
let R = null;
function init() {
  if (R) return R;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const el = renderer.domElement; el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .35;
  const camera = new THREE.PerspectiveCamera(62, 1, .05, 120); scene.add(camera);
  const hemi = new THREE.HemisphereLight(PAL.sky, PAL.earth, .9); scene.add(hemi);
  const key = new THREE.DirectionalLight(PAL.moon, 1.7); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 5, bottom: -4, near: .5, far: 20 }); key.shadow.bias = -.0006; key.shadow.normalBias = .02; key.shadow.radius = 5;
  scene.add(key); scene.add(key.target);
  const back = new THREE.DirectionalLight(0xFFB070, .7); scene.add(back); scene.add(back.target);
  // suolo: riceve solo ombre (sopra il video) + ombra di contatto morbida
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: .55, color: 0x05040A })); ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND_Y; ground.receiveShadow = true; scene.add(ground);
  const blobT = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(0,0,0,.85)'); r.addColorStop(.5, 'rgba(0,0,0,.4)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobT, transparent: true, depthWrite: false })); blob.rotation.x = -Math.PI / 2; blob.renderOrder = 1; scene.add(blob);
  // terreno finto quando manca la fotocamera
  const fakeTex = texSet(256, (x, y) => { const n = tn(x, y, 14, 5), m = tn(x + .4, y, 5, 3); return { c: mix(mix(hex(0x14120E), hex(0x3A3428), sat(.5 + n)), hex(0x1E2A16), sat(m * 2)), r: .95, h: n }; }, { bump: 3 });
  fakeTex.map.repeat.set(10, 10); fakeTex.normalMap.repeat.set(10, 10); fakeTex.roughnessMap.repeat.set(10, 10);
  const fakeGround = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ ...fakeTex, emissiveMap: null })); fakeGround.rotation.x = -Math.PI / 2; fakeGround.position.y = GROUND_Y - .002; fakeGround.receiveShadow = true; scene.add(fakeGround);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .6, .55, 1.0); composer.addPass(bloom); composer.addPass(new OutputPass());
  R = { renderer, el, scene, camera, key, back, hemi, ground, blob, fakeGround, composer, bloom, video: null, vtex: null, mon: null, cache: {}, w: 0, h: 0, t0: performance.now(), raycaster: new THREE.Raycaster(), shake: 0 };
  return R;
}
function resize(w, h) { if (R.w === w && R.h === h) return; R.w = w; R.h = h; R.renderer.setSize(w, h, false); R.composer.setSize(w, h);
  R.bloom.resolution.set(w / 2, h / 2); R.camera.aspect = w / h; R.camera.updateProjectionMatrix(); }
function setVideo(video) {
  R.video = video || null;
  if (R.vtex) { R.vtex.dispose(); R.vtex = null; }
  if (video) { R.vtex = new THREE.VideoTexture(video); R.vtex.colorSpace = THREE.SRGBColorSpace; R.scene.background = R.vtex; R.scene.fog = null; R.fakeGround.visible = false; }
  else { R.scene.background = new THREE.Color(0x07080D); R.scene.fog = new THREE.FogExp2(0x0B0C14, .07); R.fakeGround.visible = true; }
}
function coverVideo() { // la texture del video copre lo schermo come object-fit: cover
  const v = R.video; if (!v || !v.videoWidth) return; const va = v.videoWidth / v.videoHeight, sa = R.w / R.h, t = R.vtex;
  if (va > sa) { t.repeat.set(sa / va, 1); t.offset.set((1 - sa / va) / 2, 0); } else { t.repeat.set(1, va / sa); t.offset.set(0, (1 - va / sa) / 2); }
}
const qScreen = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5)), qz = new THREE.Quaternion(), euler = new THREE.Euler(), qDev = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
function orientCamera(o) {
  if (o.ori && o.ori.b != null) {
    const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    euler.set(o.ori.b * D2R, (o.ori.a || 0) * D2R, -(o.ori.g || 0) * D2R, 'YXZ'); qDev.setFromEuler(euler); qDev.multiply(qScreen); qDev.multiply(qz.setFromAxisAngle(Z, -so * D2R));
    qYaw.setFromAxisAngle(Y, -(o.manualOffset || 0) * D2R); R.camera.quaternion.copy(qYaw).multiply(qDev);
  } else { euler.set(0, -o.viewH * D2R, 0, 'YXZ'); R.camera.quaternion.setFromEuler(euler); }
}

const v3 = new THREE.Vector3();
export const AR3D = {
  ok: true,
  start(container, type, opts = {}) {
    init(); container.insertBefore(R.el, opts.before || container.firstChild);
    if (R.mon) R.scene.remove(R.mon.root);
    if (!R.cache[type]) R.cache[type] = BUILDERS[type]();
    const M = R.mon = R.cache[type]; M.u.dissolve.value = 1; M.u.flash.value = 0; M.spawn = 0; M.dying = 0; M.dieT = 0; M.drop = 0; M.recoil = 0;
    R.scene.add(M.root); setVideo(opts.video || null); R.t0 = performance.now(); R.el.style.display = 'block';
  },
  setVideo(v) { if (R) setVideo(v); },
  stop() { if (!R) return; if (R.mon) R.scene.remove(R.mon.root); R.mon = null; R.el.style.display = 'none'; setVideo(null); },
  hit() { if (R && R.mon) { R.mon.u.flash.value = .9; R.mon.recoil = 1; } },
  shake(a = 1) { if (R) R.shake = Math.max(R.shake, a); },
  die() { if (R && R.mon) R.mon.dying = .0001; },
  // ritorna la posizione a schermo del mostro per HUD, monete e frecce
  frame(now, dt, o) {
    if (!R || !R.mon) return null; const c = R.el.parentNode; const w = c.clientWidth, h = c.clientHeight; resize(w, h);
    const M = R.mon, t = (now - R.t0) / 1000;
    R.ema = R.ema == null ? dt : R.ema * .95 + dt * .05;
    if (!R.low && t > 3 && R.ema > .045) { R.low = true; R.renderer.setPixelRatio(1); R.bloom.enabled = false; R.key.shadow.radius = 2; R.w = 0; }
    orientCamera(o);
    if (R.shake > 0) { R.camera.rotateZ((Math.random() - .5) * .03 * R.shake); R.camera.rotateX((Math.random() - .5) * .03 * R.shake); R.shake = Math.max(0, R.shake - dt * 3); }
    // posizione nel mondo: direzione della bussola di gioco, distanza fissa, a terra
    const d = DIST * (M.scaleDist || 1), br = o.br * D2R; const dx = Math.sin(br), dz = -Math.cos(br);
    M.recoil = Math.max(0, M.recoil - dt * 4); const back = M.recoil * .25;
    M.root.position.set(dx * (d + back), GROUND_Y, dz * (d + back)); M.root.lookAt(0, GROUND_Y, 0);
    // entrata, colpi, morte
    if (M.spawn < 1) { M.spawn = Math.min(1, t / 1.2); M.u.dissolve.value = 1 - M.spawn; }
    if (M.dying > 0) { if (!M.dieT) M.dieT = t; M.dying = (t - M.dieT) / 1.3 + .0001; M.u.dissolve.value = Math.min(1, M.dying); }
    M.u.flash.value = Math.max(0, M.u.flash.value - dt * 4);
    M.update(t, dt, { wind: o.wind ? 1 : 0, lunge: o.lunge || 0, phase: o.phase || 1, camera: R.camera });
    M.root.scale.setScalar(1 - M.recoil * .04);
    // luci che seguono il mostro
    const mp = M.root.position; R.key.position.set(mp.x - 3 * dz - 1.5 * dx, 7, mp.z + 3 * dx - 1.5 * dz); R.key.target.position.copy(mp);
    R.back.position.set(mp.x + dx * 6, 3, mp.z + dz * 6); R.back.target.position.copy(mp);
    R.blob.position.set(mp.x, GROUND_Y + .003, mp.z); const bs = M.radius * 2.6 * (1 - Math.min(1, M.hover / 6)); R.blob.scale.set(bs, bs, 1); R.blob.material.opacity = (1 - M.u.dissolve.value) * (M.hover > 1 ? .55 : .9);
    R.ground.position.set(mp.x, GROUND_Y, mp.z);
    if (R.video) coverVideo();
    R.composer.render();
    // proiezione per l'HUD 2D
    v3.set(0, M.center + (M.body.position.y || 0) * 0, 0); M.root.localToWorld(v3); const world = v3.clone();
    const camSpace = world.clone().applyMatrix4(R.camera.matrixWorldInverse); const ahead = camSpace.z < 0;
    v3.project(R.camera); const sx = (v3.x * .5 + .5) * w, sy = (-v3.y * .5 + .5) * h;
    const edge = world.clone().add(new THREE.Vector3(0, M.radius, 0)).project(R.camera); const size = Math.abs(((-edge.y * .5 + .5) * h) - sy) * 2;
    return { x: sx, y: sy, size, ahead, rel: Math.atan2(camSpace.x, -camSpace.z) / D2R, up: Math.atan2(camSpace.y, -camSpace.z) / D2R };
  },
  hitTest(px, py) {
    if (!R || !R.mon) return false; const r = R.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((px) / r.width) * 2 - 1, -((py) / r.height) * 2 + 1); R.raycaster.setFromCamera(ndc, R.camera);
    const hits = R.raycaster.intersectObject(R.mon.body, true).filter(h => h.object.isMesh); return hits.length > 0;
  }
};
window.AR3D = AR3D;
window.dispatchEvent(new Event('ar3d-ready'));
