import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBDatabase } from 'fake-indexeddb';

const requestResult = request => new Promise((resolve,reject) => {request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const complete = tx => new Promise((resolve,reject) => {tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});

test('IndexedDB v1 migration, separate stores, atomic patch merging, rollback and workbook replacement preserve records', async () => {
  globalThis.indexedDB=indexedDB;
  const opening=indexedDB.open('paceup-local',1);
  opening.onupgradeneeded=()=>opening.result.createObjectStore('workbooks');
  const old=await requestResult(opening);
  const seed=old.transaction('workbooks','readwrite');
  seed.objectStore('workbooks').put({name:'old.xlsx',buffer:new ArrayBuffer(4)},'current');
  await complete(seed);old.close();
  const {readWorkbook,saveWorkbook,deleteWorkbook,readSessionRecords,updateSessionRecord,seedHistoricalSessions}=await import('../src/storage.js');
  assert.equal((await readWorkbook()).name,'old.xlsx');
  assert.deepEqual(await readSessionRecords(),[]);
  await updateSessionRecord('2026-09-29',{done:true,planTitle:'6K'});
  await updateSessionRecord('2026-09-29',{note:'Buena sesión'});
  await saveWorkbook('updated.xlsx',new ArrayBuffer(8));
  const records=await readSessionRecords();assert.equal(records[0].done,true);assert.equal(records[0].note,'Buena sesión');
  assert.equal((await readWorkbook()).name,'updated.xlsx');
  await deleteWorkbook();assert.equal(await readWorkbook(),undefined);assert.deepEqual(await readSessionRecords(),records);
  const original=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);if(args[0]==='sessions'&&args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx;};
  try { await assert.rejects(updateSessionRecord('2026-09-29',{done:false,note:'No guardar'})); }
  finally { IDBDatabase.prototype.transaction=original; }
  assert.deepEqual(await readSessionRecords(),records);
  // Two tabs' independent done/note updates must merge inside serialized IDB transactions.
  await Promise.all([updateSessionRecord('2026-09-29',{done:false}),updateSessionRecord('2026-09-29',{note:'Actualizada'})]);
  const merged=(await readSessionRecords())[0];assert.equal(merged.done,false);assert.equal(merged.note,'Actualizada');assert.equal(merged.planTitle,'6K');
  const historical = (date,title='8K') => ({date,done:true,historicalCutoff:'2026-09-30',planTitle:title,planSignature:title});
  // The requested initial backfill also marks existing undone records once.
  assert.equal(await seedHistoricalSessions([historical('2026-09-29'),historical('2026-09-30')]),2);
  let seeded=await readSessionRecords();
  assert.equal(seeded.find(r=>r.date==='2026-09-29').note,'Actualizada');
  await updateSessionRecord('2026-09-29',{done:false});
  assert.equal(await seedHistoricalSessions([historical('2026-09-29','10K')]),0);
  seeded=await readSessionRecords();
  assert.equal(seeded.find(r=>r.date==='2026-09-29').done,false);
  assert.equal(seeded.find(r=>r.date==='2026-09-29').planTitle,'8K');
  await updateSessionRecord('2026-09-28',{done:true,planTitle:'Original',note:'Guardada'});
  await seedHistoricalSessions([historical('2026-09-28','Cambio')]);
  assert.equal((await readSessionRecords()).find(r=>r.date==='2026-09-28').planTitle,'Original');
  IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);if(args[0]==='sessions'&&args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx;};
  try { await assert.rejects(seedHistoricalSessions([historical('2026-09-27')])); }
  finally { IDBDatabase.prototype.transaction=original; }
  assert.equal((await readSessionRecords()).find(r=>r.date==='2026-09-27'),undefined);
  delete globalThis.indexedDB;
});
