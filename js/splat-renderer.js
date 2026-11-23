// Orthographic Gaussian projection in pixel space. Both panels share one camera.
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 scales;
layout(location=2) in vec4 rgba;
layout(location=3) in vec4 encodedRotation;
uniform vec3 rightAxis, upAxis;
uniform vec2 offset, panelSize;
uniform float pixelsPerMeter, maxPointSize;
out vec3 conic;
out vec4 tint;
out float diameter;
vec3 rotateBack(vec3 v, vec4 q) {
  return v + 2.0 * cross(-q.yzw, cross(-q.yzw, v) + q.x * v);
}
void main() {
  vec2 projected = vec2(dot(position,rightAxis), dot(position,upAxis)) - offset;
  gl_Position = vec4(2.0 * projected * pixelsPerMeter / panelSize, 0, 1);
  vec4 q = normalize((encodedRotation * 255.0 - 128.0) / 128.0);
  vec3 x = rotateBack(rightAxis,q) * scales * pixelsPerMeter;
  vec3 y = rotateBack(upAxis,q) * scales * pixelsPerMeter;
  float a = dot(x,x) + .30, b = dot(x,y), c = dot(y,y) + .30;
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

function upload(gl, bytes) {
  if (!bytes.byteLength || bytes.byteLength % 32) throw Error('Invalid splat data');
  const count = bytes.byteLength / 32, values = new Float32Array(bytes);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.STATIC_DRAW);
  for (const [i, offset] of [0,12,24,28].entries()) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i,i<2?3:4,i<2?gl.FLOAT:gl.UNSIGNED_BYTE,i>=2,32,offset);
  }
  const indices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,count * 4,gl.DYNAMIC_DRAW);
  // Keep only the framing sample on the UI thread before transferring the model.
  const stride=Math.max(1,Math.floor(count/5000));
  const sample=new Float32Array(Math.ceil(count/stride)*3);
  for(let i=0,j=0;i<count;i+=stride,j+=3) {
    sample[j]=values[i*8]; sample[j+1]=values[i*8+1]; sample[j+2]=values[i*8+2];
  }
  return {vao,indices,count,sample};
}

export function createRenderer(canvas, buffers, centerEach, onReady, onError) {
  const gl = canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,powerPreference:'low-power'});
  if (!gl) throw Error('WebGL 2 unavailable');
  const program = programFor(gl);
  gl.useProgram(program);
  const loc = Object.fromEntries(['rightAxis','upAxis','offset','panelSize','pixelsPerMeter','maxPointSize'].map(k=>[k,gl.getUniformLocation(program,k)]));
  const models=buffers.map(bytes=>upload(gl,bytes));
  gl.uniform1f(loc.maxPointSize,gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(1,1,1,1);
  const worker=new Worker(new URL('./splat-sort.js',import.meta.url),{type:'module'});
  worker.postMessage({buffers},buffers);
  let view, sortedYaw, sortedPitch, ready=false, pending=false;
  worker.onerror=onError;
  worker.onmessage=({data})=>{
    for(let i=0;i<models.length;i++) {
      gl.bindVertexArray(models[i].vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,models[i].indices);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER,0,data.orders[i]);
    }
    pending=false;
    sortedYaw=data.yaw; sortedPitch=data.pitch;
    const first=!ready;
    ready=true;
    draw(...view, data.orders);
    if(first) onReady();
  };

  function draw(yaw,pitch,zoom,recycle) {
    view=[yaw,pitch,zoom];
    const dpr=Math.min(devicePixelRatio,2);
    const w=Math.max(1,Math.round(canvas.clientWidth*dpr/2)),h=Math.max(1,Math.round(canvas.clientHeight*dpr));
    if (canvas.width!==2*w || canvas.height!==h) { canvas.width=2*w; canvas.height=h; }
    const c=Math.cos(yaw),s=Math.sin(yaw),t=Math.sin(pitch),v=Math.cos(pitch);
    const right=[c,s,0], up=[-s*t,c*t,v], back=[s*v,-c*v,t];
    if (!pending && (yaw!==sortedYaw || pitch!==sortedPitch)) {
      pending=true;
      const orders=recycle || [];
      worker.postMessage({yaw,pitch,back,orders},orders.map(order=>order.buffer));
    } else if(recycle) {
      worker.postMessage({orders:recycle},recycle.map(order=>order.buffer));
    }
    if (!ready) return;
    const bounds = models.map(({sample}) => {
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for(let j=0;j<sample.length;j+=3) {
        const x=sample[j]*c+sample[j+1]*s;
        const y=sample[j]*up[0]+sample[j+1]*up[1]+sample[j+2]*v;
        x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y);
      }
      return {x0,x1,y0,y1};
    });
    const x0=Math.min(...bounds.map(b=>b.x0)), x1=Math.max(...bounds.map(b=>b.x1));
    const y0=Math.min(...bounds.map(b=>b.y0)), y1=Math.max(...bounds.map(b=>b.y1));
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform3fv(loc.rightAxis,right); gl.uniform3fv(loc.upAxis,up);
    gl.uniform2f(loc.panelSize,w,h);
    gl.uniform1f(loc.pixelsPerMeter,.91*zoom*Math.min(w/(x1-x0),h/(y1-y0)));
    for (const [i,model] of models.entries()) {
      const box = centerEach ? bounds[i] : {x0,x1,y0,y1};
      gl.uniform2f(loc.offset,(box.x0+box.x1)/2,(box.y0+box.y1)/2);
      gl.viewport(i*w,0,w,h);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(i*w,0,w,h);
      gl.bindVertexArray(model.vao);
      gl.drawElements(gl.POINTS,model.count,gl.UNSIGNED_INT,0);
    }
    gl.disable(gl.SCISSOR_TEST);
  }
  return {draw, dispose:()=>worker.terminate()};
}
