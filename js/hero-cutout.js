(() => {
// Use the same decoded frame for the room and its silhouette.
const film = document.getElementById('cinema-film');
const stage = film.closest('.hero-scene');
const canvas = stage.querySelector('canvas');
let gl, texture, frameCallback, visible = false, lastTime = -1, needsResize = true;

function useNativeCutout() {
  // A file URL cannot be used as a WebGL video texture in some browsers.
  // These local, transparent replays can be composited directly by the browser.
  const source = nativeHeroSource(film);
  film.dataset.nativeAlpha = '';
  film.style.opacity = '1';
  canvas.style.display = 'none';
  if (frameCallback != null) {
    if (film.cancelVideoFrameCallback) film.cancelVideoFrameCallback(frameCallback);
    else cancelAnimationFrame(frameCallback);
    frameCallback = null;
  }
  stage.dataset.cutoutReady = '';
  film.addEventListener('error', () => {
    // Keep the regular H.264 replay usable if this browser lacks alpha decoding.
    film.src = 'media/hero.mp4?v=native30';
    syncPlayback();
  }, {once:true});
  if (film.src !== source) film.src = source;
  syncPlayback();
}
if (location.protocol === 'file:') {
  useNativeCutout();
  return;
}

function setup() {
  gl = canvas.getContext('webgl', {alpha:true, premultipliedAlpha:true, antialias:false, depth:false});
  if (!gl) return false;
  const program = gl.createProgram();
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, 'attribute vec2 pos; varying vec2 uv; void main(){uv=vec2(pos.x,-pos.y)*0.5+0.5;gl_Position=vec4(pos,0.,1.);}'],
    [gl.FRAGMENT_SHADER, `precision mediump float;
      varying vec2 uv;
      uniform sampler2D frame;
      void main() {
        vec3 rgb = texture2D(frame, uv).rgb;
        float luma = dot(rgb, vec3(.265, .470, .265));
        float alpha = smoothstep(.025, .086, 1. - luma);
        gl_FragColor = vec4(max(vec3(0.), rgb - (1. - alpha)), alpha);
      }`]
  ]) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program,'pos');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return true;
}
function update() {
  const dark = document.documentElement.dataset.theme === 'dark';
  if (!visible || !dark || document.hidden || film.readyState < 2) {
    if (frameCallback != null) {
      if (film.cancelVideoFrameCallback) film.cancelVideoFrameCallback(frameCallback);
      else cancelAnimationFrame(frameCallback);
      frameCallback = null;
    }
    return;
  }
  if (film.hasAttribute('data-native-alpha') || gl?.isContextLost()) return;
  if (!texture && !setup()) {
    useNativeCutout();
    return;
  }
  if (lastTime !== film.currentTime) {
    if (needsResize) {
      const scale = Math.min(1, devicePixelRatio * Math.min(
        stage.clientWidth / film.videoWidth, stage.clientHeight / film.videoHeight
      ));
      canvas.width = Math.max(1, Math.round(film.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(film.videoHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      needsResize = false;
    }
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, film);
    } catch (error) {
      if (error.name !== 'SecurityError') throw error;
      useNativeCutout();
      return;
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    lastTime = film.currentTime;
    if (!stage.hasAttribute('data-cutout-ready')) stage.dataset.cutoutReady = '';
  }
  if (frameCallback == null && !film.paused) {
    const next = () => {frameCallback = null; update();};
    frameCallback = film.requestVideoFrameCallback ? film.requestVideoFrameCallback(next) : requestAnimationFrame(next);
  }
}
canvas.addEventListener('webglcontextlost', event=>{
  event.preventDefault();
  delete stage.dataset.cutoutReady;
  lastTime=-1;
});
canvas.addEventListener('webglcontextrestored', ()=>{texture=null; lastTime=-1; update();});
function resize() {
  needsResize = true;
  lastTime = -1;
  update();
}
new ResizeObserver(resize).observe(stage);
film.addEventListener('resize', resize);
new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update();}).observe(stage);
new MutationObserver(update).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
for(const event of ['loadeddata','playing','seeked']) film.addEventListener(event,update);
document.addEventListener('visibilitychange',update);
})();
