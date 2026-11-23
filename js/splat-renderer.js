// Orthographic Gaussian projection in pixel space. Both panels share one camera.
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 covarianceA;
layout(location=2) in vec3 covarianceB;
layout(location=3) in vec4 rgba;
uniform vec3 rightAxis, upAxis;
uniform vec2 offset, panelSize;
uniform float pixelsPerMeter, maxPointSize;
out vec3 conic;
out vec4 tint;
out float diameter;
void main() {
  vec2 projected = vec2(dot(position,rightAxis), dot(position,upAxis)) - offset;
  gl_Position = vec4(2.0 * projected * pixelsPerMeter / panelSize, 0, 1);
  mat3 cov=mat3(covarianceA, vec3(covarianceA.y,covarianceB.xy),
                vec3(covarianceA.z,covarianceB.yz));
  vec3 x=cov*rightAxis, y=cov*upAxis;
  float factor=pixelsPerMeter*pixelsPerMeter;
  float a=dot(rightAxis,x)*factor+.30, b=dot(upAxis,x)*factor, c=dot(upAxis,y)*factor+.30;
  conic = vec3(c,-b,a) / (a*c-b*b);
  diameter = clamp(ceil(6.0 * sqrt(max(a,c))), 1.0, maxPointSize);
  gl_PointSize = diameter;
  tint = rgba;
}`;
const fragment = `#version 300 es
precision highp float;
in vec3 conic;
in vec4 tint;
in float diameter;
out vec4 color;
void main() {
  vec2 p = (gl_PointCoord - .5) * vec2(diameter,-diameter);
  float power = -.5 * dot(conic,vec3(p.x*p.x,2.0*p.x*p.y,p.y*p.y));
  if (power < -4.5) discard;
  float alpha = tint.a * exp(power);
  color = vec4(tint.rgb * alpha,alpha);
}`;

function programFor(gl) {
  const program = gl.createProgram();
  for (const [kind, source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program,shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  return program;
}

function upload(gl,{vertices,order}) {
  const vao=gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
  for(let i=0;i<4;i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i,i===3?4:3,i===3?gl.UNSIGNED_BYTE:gl.FLOAT,i===3,40,i*12);
  }
  const indices=gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,order,gl.DYNAMIC_DRAW);
  return {vao,count:order.length};
}

function camera(yaw,pitch) {
  const c=Math.cos(yaw),s=Math.sin(yaw),t=Math.sin(pitch),v=Math.cos(pitch);
  return {right:[c,s,0],up:[-s*t,c*t,v],back:[s*v,-c*v,t]};
}

function projectedBounds(sample,right,up) {
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(let j=0;j<sample.length;j+=3) {
    const x=sample[j]*right[0]+sample[j+1]*right[1];
    const y=sample[j]*up[0]+sample[j+1]*up[1]+sample[j+2]*up[2];
    x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y);
  }
  return {x0,x1,y0,y1};
}

export function createRenderer(canvas,blobs,centerEach,onReady,onError) {
  const worker=new Worker(new URL('./splat-sort.js?v=motion-lod-1',import.meta.url),{type:'module'});
  const levels={};
  let gl, loc, samples, frame=0;
  const initialYaw=.93, initialPitch=.64;
  let yaw=initialYaw, pitch=initialPitch, zoom=1, visible=false, sorting=false, disposed=false;
  let geometry, geometryYaw, geometryPitch, settleTimer, interacting=false;
  worker.onerror=onError;
  const motionBudget=matchMedia('(pointer:coarse)').matches ? 36000 : 64000;
  worker.postMessage({blobs,motionBudget,back:camera(yaw,pitch).back});
  function initialize(panels) {
    gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'high-performance'});
    if(!gl) throw Error('WebGL 2 unavailable');
    const program=programFor(gl);
    gl.useProgram(program);
    loc=Object.fromEntries(['rightAxis','upAxis','offset','panelSize','pixelsPerMeter','maxPointSize'].map(k=>[k,gl.getUniformLocation(program,k)]));
    gl.uniform1f(loc.maxPointSize,gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(1,1,1,1);
    samples=panels.map(panel=>panel.sample);
    for(const level of ['full','motion']) {
      levels[level]={
        models:panels.map(panel=>upload(gl,panel[level])),
        orders:panels.map(panel=>panel[level].order),
        yaw:initialYaw,pitch:initialPitch,dirty:false
      };
    }
  }
  worker.onmessage=({data})=>{
    if(disposed) return;
    if(data.error) {onError(Error(data.error)); return;}
    try {
      if(data.panels) {initialize(data.panels); onReady();}
      else {
        const layer=levels[data.level];
        layer.yaw=data.yaw; layer.pitch=data.pitch;
        layer.orders=data.orders; layer.dirty=true;
        sorting=false;
      }
      schedule();
    } catch(error) {onError(error);}
  };
  function schedule() {
    if(visible && samples && !frame) frame=requestAnimationFrame(render);
  }
  function render() {
    frame=0;
    const {right,up,back}=camera(yaw,pitch);
    const target=interacting?'motion':'full';
    const layer=levels[target];
    const delta=Math.abs(yaw-layer.yaw)+Math.abs(pitch-layer.pitch);
    // Keep displaying the responsive surface until the dense depth order for
    // the final pose arrives. Never draw a million stale points between tiers.
    const display=(!interacting && delta>0) ? levels.motion : layer;
    if(display.dirty) {
      for(const [i,model] of display.models.entries()) {
        gl.bindVertexArray(model.vao);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,display.orders[i],gl.DYNAMIC_DRAW);
      }
      display.dirty=false;
    }
    if(!sorting && delta>(interacting ? .035 : 0)) {
      sorting=true;
      worker.postMessage({level:target,yaw,pitch,back,orders:layer.orders},layer.orders.map(order=>order.buffer));
      layer.dirty=false;
    }
    // Keep the backing store stable across pointer events on high-density displays.
    const dpr=Math.min(devicePixelRatio,2);
    const w=Math.max(1,Math.round(canvas.clientWidth*dpr/2)), h=Math.max(1,Math.round(canvas.clientHeight*dpr));
    if(canvas.width!==2*w || canvas.height!==h) { canvas.width=2*w; canvas.height=h; }
    if(!geometry || geometryYaw!==yaw || geometryPitch!==pitch) {
      geometry=samples.map(sample=>projectedBounds(sample,right,up));
      geometryYaw=yaw; geometryPitch=pitch;
    }
    const [a,b]=geometry;
    const x0=Math.min(a.x0,b.x0),x1=Math.max(a.x1,b.x1),y0=Math.min(a.y0,b.y0),y1=Math.max(a.y1,b.y1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform3fv(loc.rightAxis,right); gl.uniform3fv(loc.upAxis,up);
    gl.uniform2f(loc.panelSize,w,h);
    gl.uniform1f(loc.pixelsPerMeter,.91*zoom*Math.min(w/Math.max(.01,x1-x0),h/Math.max(.01,y1-y0)));
    gl.enable(gl.SCISSOR_TEST);
    for(const [i,model] of display.models.entries()) {
      const box=centerEach?geometry[i]:{x0,x1,y0,y1};
      gl.uniform2f(loc.offset,(box.x0+box.x1)/2,(box.y0+box.y1)/2);
      gl.viewport(i*w,0,w,h); gl.scissor(i*w,0,w,h);
      gl.bindVertexArray(model.vao);
      gl.drawElements(gl.POINTS,model.count,gl.UNSIGNED_INT,0);
    }
    gl.disable(gl.SCISSOR_TEST);
  }
  return {
    draw(y,p,z,moving=false) {
      yaw=y; pitch=p; zoom=z; visible=true;
      interacting=moving; clearTimeout(settleTimer);
      if(moving) {
        settleTimer=setTimeout(()=>{interacting=false; schedule();},180);
      }
      schedule();
    },
    hide() {
      visible=false; interacting=false;
      cancelAnimationFrame(frame); frame=0; clearTimeout(settleTimer);
    },
    dispose() {
      disposed=true; cancelAnimationFrame(frame); clearTimeout(settleTimer); worker.terminate();
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}
