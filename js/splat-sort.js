// A stable back-to-front counting sort for the two Gaussian comparison panels.
let models;
let availableOrders;
self.onmessage=({data})=>{
  if (data.buffers) {
    models=data.buffers.map(buffer=>{
      const count=buffer.byteLength/32;
      const positions=new Float32Array(count*3);
      const values=new Float32Array(buffer);
      for(let i=0;i<count;i++) {
        positions[i*3]=values[i*8];
        positions[i*3+1]=values[i*8+1];
        positions[i*3+2]=values[i*8+2];
      }
      return {positions,depths:new Int32Array(count),bins:new Uint32Array(4096)};
    });
    return;
  }
  if(data.orders?.length) availableOrders=data.orders;
  if(!data.back) return;
  const orders=availableOrders || models.map(({depths})=>new Uint32Array(depths.length));
  availableOrders=null;
  const [x,y,z]=data.back;
  models.forEach(({positions,depths,bins},panel)=>{
    bins.fill(0);
    let min=Infinity,max=-Infinity;
    for(let i=0,j=0;i<depths.length;i++,j+=3) {
      const depth=Math.round(1000*(positions[j]*x+positions[j+1]*y+positions[j+2]*z));
      depths[i]=depth;
      min=Math.min(min,depth); max=Math.max(max,depth);
    }
    const step=(bins.length-1)/Math.max(1,max-min);
    for(let i=0;i<depths.length;i++) {
      depths[i]=Math.floor((depths[i]-min)*step);
      bins[depths[i]]++;
    }
    let start=0;
    for(let i=0;i<bins.length;i++) {
      const count=bins[i];
      bins[i]=start;
      start+=count;
    }
    for(let i=0;i<depths.length;i++) orders[panel][bins[depths[i]]++]=i;
  });
  self.postMessage({yaw:data.yaw,pitch:data.pitch,orders},orders.map(order=>order.buffer));
};
