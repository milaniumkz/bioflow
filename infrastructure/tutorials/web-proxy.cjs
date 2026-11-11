const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(process.env.COLLECTION_TUTORIAL_MEDIA||'work/tutorial-final');
http.createServer((req,res)=>{
 if(req.url.startsWith('/downloads/tutorials/')){
  const name=decodeURIComponent(req.url.split('?')[0].split('/').pop());if(!/^[a-zA-Z0-9_.-]+$/.test(name)||name.startsWith('.')){res.writeHead(403).end();return;}
  const file=path.join(root,name);let st;try{st=fs.statSync(file);}catch{res.writeHead(404).end();return;}
  let start=0,end=st.size-1,status=200;const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??'');if(range){start=+range[1];end=range[2]?Math.min(+range[2],end):end;status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${st.size}`);}
  res.writeHead(status,{'Content-Type':name.endsWith('.mp4')?'video/mp4':name.endsWith('.jpg')?'image/jpeg':'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes'});fs.createReadStream(file,{start,end}).pipe(res);return;
 }
 const backend=req.url.startsWith('/api/');const upstream=http.request({hostname:'127.0.0.1',port:backend?Number(process.env.COLLECTION_TUTORIAL_PROXY_API_PORT||4198):Number(process.env.COLLECTION_TUTORIAL_WEB_PORT||3197),path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>res.writeHead(502).end());req.pipe(upstream);
}).listen(Number(process.env.COLLECTION_TUTORIAL_PROXY_PORT||3198),'0.0.0.0');
