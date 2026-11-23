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

function upload(gl,{vertices,sample},order) {
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
  return {vao,indices,sample,count:order.length};
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

export function createRenderer(canvas,urls,centerEach,onReady,onError) {
  const worker=new Worker(new URL('./splat-sort.js?v=dense-ply-2',import.meta.url),{type:'module'});
  let gl, loc, models, orders, frame=0, sortedYaw=.93, sortedPitch=.64;
  let yaw=sortedYaw, pitch=sortedPitch, zoom=1, visible=false, sorting=true, disposed=false;
  let geometry, geometryYaw, geometryPitch, settleTimer, interacting=false;
  worker.onerror=onError;
  worker.postMessage({urls,yaw,pitch,back:camera(yaw,pitch).back});
  function initialize(panels,indices) {
    gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'high-performance'});
    if(!gl) throw Error('WebGL 2 unavailable');
    const program=programFor(gl);
    gl.useProgram(program);
    loc=Object.fromEntries(['rightAxis','upAxis','offset','panelSize','pixelsPerMeter','maxPointSize'].map(k=>[k,gl.getUniformLocation(program,k)]));
    gl.uniform1f(loc.maxPointSize,gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(1,1,1,1);
    models=panels.map((panel,i)=>upload(gl,panel,indices[i]));
  }
  worker.onmessage=({data})=>{
    if(disposed) return;
    if(data.error) {onError(Error(data.error)); return;}
    try {
      const first=!!data.panels;
      if(first) initialize(data.panels,data.orders);
      else {
        for(const [i,model] of models.entries()) {
          gl.bindVertexArray(model.vao);
          gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER,0,data.orders[i]);
        }
      }
      orders=data.orders; sorting=false;
      sortedYaw=data.yaw; sortedPitch=data.pitch;
      if(first) onReady();
      schedule();
    } catch(error) {onError(error);}
  };
  function schedule() {
    if(visible && models && !frame) frame=requestAnimationFrame(render);
  }
  function render() {
    frame=0;
    const {right,up,back}=camera(yaw,pitch);
    const delta=Math.abs(yaw-sortedYaw)+Math.abs(pitch-sortedPitch);
    if(!sorting && delta>(interacting ? .045 : 0)) {
      sorting=true;
      worker.postMessage({yaw,pitch,back,orders},orders.map(order=>order.buffer));
      orders=null;
    }
    // Lower pixel fill cost during motion while retaining every Gaussian.
    const dpr=Math.min(devicePixelRatio,interacting?1:1.5);
    const w=Math.max(1,Math.round(canvas.clientWidth*dpr/2)), h=Math.max(1,Math.round(canvas.clientHeight*dpr));
    if(canvas.width!==2*w || canvas.height!==h) { canvas.width=2*w; canvas.height=h; }
    if(!geometry || geometryYaw!==yaw || geometryPitch!==pitch) {
      geometry=models.map(model=>projectedBounds(model.sample,right,up));
      geometryYaw=yaw; geometryPitch=pitch;
    }
    const [a,b]=geometry;
    const x0=Math.min(a.x0,b.x0),x1=Math.max(a.x1,b.x1),y0=Math.min(a.y0,b.y0),y1=Math.max(a.y1,b.y1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform3fv(loc.rightAxis,right); gl.uniform3fv(loc.upAxis,up);
    gl.uniform2f(loc.panelSize,w,h);
    gl.uniform1f(loc.pixelsPerMeter,.91*zoom*Math.min(w/Math.max(.01,x1-x0),h/Math.max(.01,y1-y0)));
    gl.enable(gl.SCISSOR_TEST);
    for(const [i,model] of models.entries()) {
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
      if(moving) {
        interacting=true; clearTimeout(settleTimer);
        settleTimer=setTimeout(()=>{interacting=false; schedule();},140);
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
