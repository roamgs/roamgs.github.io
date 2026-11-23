// Decode the fixed PlayCanvas compressed PLY layout and sort away from the UI thread.
let models;
const mix = (a,b,t) => a+(b-a)*t;

function sortable(positions) {
  return {positions,bins:new Uint32Array(4096),depths:new Int32Array(positions.length/3)};
}

function decode(buffer,motionBudget) {
  const prefix=new TextDecoder().decode(new Uint8Array(buffer,0,Math.min(2048,buffer.byteLength)));
  const end=prefix.indexOf('end_header\n');
  if(end<0) throw Error('Missing PLY header');
  const header=prefix.slice(0,end), start=end+11;
  const count=Number(header.match(/^element vertex (\d+)$/m)?.[1]);
  const chunks=Number(header.match(/^element chunk (\d+)$/m)?.[1]);
  const framing=Number(header.match(/^element framing (\d+)$/m)?.[1] || 0);
  const offset=start+chunks*72;
  if(!count || chunks!==Math.ceil(count/256) || start%4 || buffer.byteLength!==offset+count*16+framing*12)
    throw Error('Invalid compressed PLY');
  const bounds=new Float32Array(buffer,start,chunks*18);
  const packed=new Uint32Array(buffer,offset,count*4);
  const vertices=new Float32Array(count*10), colors=new Uint8Array(vertices.buffer);
  const positions=new Float32Array(count*3);
  // These files are in Morton order. Preserve a high-coverage Gaussian in each
  // spatial group, so thin surfaces remain visible while rotating either panel.
  const groupSize=Math.ceil(count/motionBudget);
  const motionCount=Math.ceil(count/groupSize);
  const motionPositions=new Float32Array(motionCount*3);
  const motionVertices=new Uint32Array(motionCount*10);
  const motionCovariances=new Float32Array(motionVertices.buffer);
  const vertexWords=new Uint32Array(vertices.buffer);
  let bestScore=-1, groupScore=0, representative=0;
  const stride=Math.max(1,Math.ceil(count/4096));
  // Compact PLYs retain the original framing points for identical orbit bounds.
  const sample=framing ? new Float32Array(buffer,offset+count*16,framing*3).slice()
                       : new Float32Array(Math.ceil(count/stride)*3);
  const q=new Float64Array(4);
  for(let i=0;i<count;i++) {
    const b=(i>>>8)*18, j=i*4, k=i*10;
    const pos=packed[j], rot=packed[j+1], scale=packed[j+2], color=packed[j+3];
    vertices[k]=positions[i*3]=mix(bounds[b],bounds[b+3],(pos>>>21)/2047);
    vertices[k+1]=positions[i*3+1]=mix(bounds[b+1],bounds[b+4],((pos>>>11)&1023)/1023);
    vertices[k+2]=positions[i*3+2]=mix(bounds[b+2],bounds[b+5],(pos&2047)/2047);
    if(!framing && i%stride===0) {
      const p=i/stride*3;
      sample[p]=vertices[k]; sample[p+1]=vertices[k+1]; sample[p+2]=vertices[k+2];
    }
    const sx=Math.exp(2*mix(bounds[b+6],bounds[b+9],(scale>>>21)/2047));
    const sy=Math.exp(2*mix(bounds[b+7],bounds[b+10],((scale>>>11)&1023)/1023));
    const sz=Math.exp(2*mix(bounds[b+8],bounds[b+11],(scale&2047)/2047));
    const largest=rot>>>30;
    let shift=20,norm=0;
    for(let axis=0;axis<4;axis++) {
      if(axis===largest) continue;
      const value=(((rot>>>shift)&1023)/1023-.5)*Math.SQRT2;
      q[axis]=value; norm+=value*value; shift-=10;
    }
    q[largest]=Math.sqrt(Math.max(0,1-norm));
    const w=q[0], x=q[1], y=q[2], z=q[3];
    const r00=1-2*(y*y+z*z), r01=2*(x*y-w*z), r02=2*(x*z+w*y);
    const r10=2*(x*y+w*z), r11=1-2*(x*x+z*z), r12=2*(y*z-w*x);
    const r20=2*(x*z-w*y), r21=2*(y*z+w*x), r22=1-2*(x*x+y*y);
    // Six independent elements of R diag(scale²) Rᵀ, in xx,xy,xz,yy,yz,zz order.
    vertices[k+3]=sx*r00*r00+sy*r01*r01+sz*r02*r02;
    vertices[k+4]=sx*r00*r10+sy*r01*r11+sz*r02*r12;
    vertices[k+5]=sx*r00*r20+sy*r01*r21+sz*r02*r22;
    vertices[k+6]=sx*r10*r10+sy*r11*r11+sz*r12*r12;
    vertices[k+7]=sx*r10*r20+sy*r11*r21+sz*r12*r22;
    vertices[k+8]=sx*r20*r20+sy*r21*r21+sz*r22*r22;
    const c=(k+9)*4;
    colors[c]=Math.round(255*mix(bounds[b+12],bounds[b+15],(color>>>24)/255));
    colors[c+1]=Math.round(255*mix(bounds[b+13],bounds[b+16],((color>>>16)&255)/255));
    colors[c+2]=Math.round(255*mix(bounds[b+14],bounds[b+17],((color>>>8)&255)/255));
    colors[c+3]=color&255;
    const score=colors[c+3]*Math.sqrt(sx*sy+sy*sz+sx*sz);
    groupScore+=score;
    if(score>bestScore) {bestScore=score; representative=i;}
    if((i+1)%groupSize===0 || i===count-1) {
      const group=Math.floor(i/groupSize);
      const src=representative*10;
      motionVertices.set(vertexWords.subarray(src,src+10),group*10);
      // Compensate for removed opacity-weighted area. Cap the footprint to
      // keep isolated walls and thin edges sharp as the camera moves.
      const footprint=bestScore>0 ? Math.min(2.5,groupScore/bestScore) : 1;
      const covariance=group*10+3;
      for(let j=covariance;j<covariance+6;j++) motionCovariances[j]*=footprint;
      const pos=representative*3;
      motionPositions.set(positions.subarray(pos,pos+3),group*3);
      bestScore=-1; groupScore=0;
    }
  }
  return {
    sample,
    full:{vertices,...sortable(positions)},
    motion:{vertices:motionVertices,...sortable(motionPositions)}
  };
}

function sort(model,back,order) {
  const {positions,bins,depths}=model, [x,y,z]=back;
  let min=Infinity,max=-Infinity;
  for(let i=0,j=0;i<depths.length;i++,j+=3) {
    const depth=Math.round(1024*(positions[j]*x+positions[j+1]*y+positions[j+2]*z));
    depths[i]=depth;
    min=Math.min(min,depth); max=Math.max(max,depth);
  }
  bins.fill(0);
  const step=(bins.length-1)/Math.max(1,max-min);
  for(let i=0;i<depths.length;i++) {
    depths[i]=Math.floor((depths[i]-min)*step);
    bins[depths[i]]++;
  }
  let start=0;
  for(let i=0;i<bins.length;i++) {
    const size=bins[i]; bins[i]=start; start+=size;
  }
  for(let i=0;i<depths.length;i++) order[bins[depths[i]]++]=i;
  return order;
}

self.onmessage=async ({data})=>{
  try {
    if(data.blobs) {
      models=await Promise.all(data.blobs.map(async blob=>decode(await blob.arrayBuffer(),data.motionBudget)));
      const transfer=[];
      const panels=models.map(model=>{
        const panel={sample:model.sample};
        transfer.push(model.sample.buffer);
        delete model.sample;
        for(const level of ['full','motion']) {
          const layer=model[level];
          const order=sort(layer,data.back,new Uint32Array(layer.depths.length));
          panel[level]={vertices:layer.vertices,order};
          transfer.push(layer.vertices.buffer,order.buffer);
          delete layer.vertices;
        }
        return panel;
      });
      self.postMessage({panels},transfer);
      return;
    }
    const {level,yaw,pitch}=data;
    const orders=models.map((model,i)=>sort(model[level],data.back,data.orders[i]));
    self.postMessage({level,yaw,pitch,orders},orders.map(order=>order.buffer));
  } catch(error) { self.postMessage({error:String(error)}); }
};
