import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRunningDriveHandler} from '../netlify/functions/running-drive.mjs';
import {RUNNING_DRIVE} from '../src/driveConfig.js';
import {fetchDriveWorkbook} from '../src/drive.js';
const bytes=new Uint8Array([0x50,0x4b,3,4,8,9,10]);
const request=new Request('https://paceup.test/.netlify/functions/running-drive');

test('server downloads only the linked workbook with fresh requests and a content revision',async()=>{
 let calledUrl,options;
 const handler=createRunningDriveHandler(async(url,opts)=>{calledUrl=url;options=opts;return new Response(bytes);});
 const result=await handler(new Request(request.url+'?url=https://evil.test&fileId=other'));
 assert.equal(result.status,200);assert.equal(calledUrl.hostname,'drive.usercontent.google.com');
 assert.equal(calledUrl.searchParams.get('id'),RUNNING_DRIVE.id);assert.equal(options.cache,'no-store');
 assert.equal(result.headers.get('cache-control'),'no-store');
 assert.equal(result.headers.get('x-paceup-revision'),createHash('sha256').update(bytes).digest('hex'));
 assert.equal(result.headers.get('x-paceup-file-id'),RUNNING_DRIVE.id);
 assert.deepEqual(new Uint8Array(await result.arrayBuffer()),bytes);
});

test('server rejects login HTML, denied downloads, empty files, excessive bodies and non-GET methods',async()=>{
 for(const upstream of [new Response('<html>Sign in</html>'),new Response('',{status:403}),new Response('')])
  assert.equal((await createRunningDriveHandler(async()=>upstream)(request)).status,502);
 const oversize=new Response(bytes,{headers:{'content-length':String(RUNNING_DRIVE.maxBytes+1)}});
 assert.equal((await createRunningDriveHandler(async()=>oversize)(request)).status,413);
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(RUNNING_DRIVE.maxBytes));controller.enqueue(bytes);controller.close();}});
 assert.equal((await createRunningDriveHandler(async()=>new Response(stream))(request)).status,413);
 let calls=0;const handler=createRunningDriveHandler(async()=>{calls++;throw Error('offline');});
 assert.equal((await handler(new Request(request.url,{method:'POST'}))).status,405);assert.equal(calls,0);
 assert.equal((await handler(request)).status,502);
});

test('browser obtains a verified workbook and bypasses cached HTTP data',async()=>{
 const revision=createHash('sha256').update(bytes).digest('hex');let called;
 const result=await fetchDriveWorkbook(async(url,options)=>{called={url,options};return new Response(bytes,{headers:{'x-paceup-file-id':RUNNING_DRIVE.id,'x-paceup-revision':revision}});});
 assert.equal(called.url,RUNNING_DRIVE.endpoint);assert.equal(called.options.cache,'no-store');
 assert.equal(result.source,'drive');assert.equal(result.driveRevision,revision);assert.equal(result.name,'Running.xlsx');
 assert.deepEqual(new Uint8Array(result.buffer),bytes);
});

test('browser fails visibly on offline, invalid XLSX, stale app routing and mismatched file IDs',async()=>{
 await assert.rejects(fetchDriveWorkbook(async()=>{throw new TypeError('Failed to fetch');}),/No se pudo conectar con Drive/);
 await assert.rejects(fetchDriveWorkbook(async()=>new Response('<html>SPA</html>')));
 await assert.rejects(fetchDriveWorkbook(async()=>new Response(bytes,{headers:{'x-paceup-file-id':'other','x-paceup-revision':'a'.repeat(64)}})));
 await assert.rejects(fetchDriveWorkbook(async()=>new Response('not an Excel',{headers:{'x-paceup-file-id':RUNNING_DRIVE.id,'x-paceup-revision':'a'.repeat(64)}})));
 await assert.rejects(fetchDriveWorkbook(async()=>new Response(JSON.stringify({error:'Drive no disponible'}),{status:502})),/Drive no disponible/);
});

test('service worker never returns a cached API response as a fresh Drive sync',()=>{
 let fetchHandler,responses=0;
 const context=vm.createContext({self:{location:{origin:'https://paceup.test'},addEventListener(event,fn){if(event==='fetch')fetchHandler=fn;}},URL,
  fetch:()=>{throw Error('Must not be used by API interception');},caches:{}});
 vm.runInContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),context);
 fetchHandler({request:{method:'GET',url:request.url,cache:'default'},respondWith(){responses++;}});
 fetchHandler({request:{method:'GET',url:'https://paceup.test/file.xlsx',cache:'no-store'},respondWith(){responses++;}});
 assert.equal(responses,0);
});

test('the first service worker install caches the built JS and CSS so the next opening can be offline',async()=>{
 let install,assets=[],waiting=false;const entries=new Map();
 const cache={put:async(key,value)=>entries.set(key,value),addAll:async urls=>{assets=urls;}};
 const context=vm.createContext({URL,Set,self:{location:{origin:'https://paceup.test'},addEventListener(event,fn){if(event==='install')install=fn;},skipWaiting:async()=>{waiting=true;}},
 caches:{open:async()=>cache},fetch:async(url,options)=>{assert.equal(url,'/');assert.equal(options.cache,'no-store');return new Response('<script src="/assets/app-abc.js"></script><link href="/assets/app-def.css"><script src="https://other.test/skip.js"></script>');}});
 vm.runInContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),context);
 let work;install({waitUntil(promise){work=promise;}});await work;
 assert.ok(entries.has('/'));assert.ok(assets.includes('https://paceup.test/assets/app-abc.js'));assert.ok(assets.includes('https://paceup.test/assets/app-def.css'));
 assert.ok(!assets.includes('https://other.test/skip.js'));assert.equal(waiting,true);
});
