import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOCATION, PILAR_LOCATION, WEATHER_TTL, readWeatherPreferences, saveWeatherPreferences, createWeatherClient, normalizeForecast, forecastURL, weatherForDate, weatherAssessment, cityDate, defaultTrainingHour, trainingHourForDate } from '../src/weather.js';
import { weatherPanelMarkup, dayWeatherMarkup } from '../src/weatherView.js';
const storage = () => { const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),values}; };
const fixture = () => ({timezone:'America/Argentina/Buenos_Aires',daily:{time:['2026-09-30','2026-10-01'],weather_code:[1,95],temperature_2m_max:[24,22],temperature_2m_min:[12,14],precipitation_probability_max:[10,80],precipitation_sum:[0,5],wind_speed_10m_max:[10,18],wind_gusts_10m_max:[15,30]},hourly:{time:['2026-09-30T18:00','2026-09-30T12:00','2026-10-01T18:00'],weather_code:[1,1,95],temperature_2m:[20,29,18],apparent_temperature:[19,30,18],precipitation_probability:[0,0,80],precipitation:[0,0,3],wind_speed_10m:[10,10,18],wind_gusts_10m:[15,15,30]}});
const response = payload => ({ok:true,json:async()=>payload});
const now = Date.parse('2026-09-30T21:00:00Z');

test('one batch includes all dates, explicit units and local time with no API key', () => {
  const url=new URL(forecastURL(DEFAULT_LOCATION));
  assert.equal(url.searchParams.get('forecast_days'),'16');assert.equal(url.searchParams.get('past_days'),'1');
  assert.equal(url.searchParams.get('temperature_unit'),'celsius');assert.equal(url.searchParams.get('wind_speed_unit'),'kmh');
  assert.equal(url.searchParams.has('apikey'),false);
  const record=normalizeForecast(fixture(),DEFAULT_LOCATION,now);
  assert.equal(weatherForDate(record,'2026-09-30',18).temperature,20);
  assert.equal(weatherForDate(record,'2026-09-30',12).temperature,29);
  assert.equal(weatherForDate(record,'2026-10-31',18),null);
  assert.equal(cityDate(record,new Date('2026-10-01T01:00:00Z')),'2026-09-30');
});

test('fresh persistent cache avoids API calls across reloads and expired data refreshes', async () => {
  const local=storage();let calls=0,clock=now;
  const options={storage:local,now:()=>clock,fetcher:async(url,opts)=>{assert.equal(opts.cache,'no-store');calls++;return response(fixture());}};
  const a=createWeatherClient(options);assert.equal((await a.load(DEFAULT_LOCATION)).source,'network');
  const b=createWeatherClient(options);assert.equal((await b.load(DEFAULT_LOCATION)).source,'cache');assert.equal(calls,1);
  clock+=WEATHER_TTL+1;assert.equal((await b.load(DEFAULT_LOCATION)).source,'network');assert.equal(calls,2);
  await b.load(DEFAULT_LOCATION,{force:true});assert.equal(calls,3);
});

test('simultaneous requests share a fetch; city caches never mix', async () => {
  const local=storage();let calls=0;
  const client=createWeatherClient({storage:local,now:()=>now,fetcher:async()=>{calls++;return response(fixture());}});
  const [a,b]=await Promise.all([client.load(DEFAULT_LOCATION),client.load(DEFAULT_LOCATION)]);assert.equal(calls,1);assert.deepEqual(a,b);
  await client.load(PILAR_LOCATION);assert.equal(calls,2);
  assert.notEqual(client.read(DEFAULT_LOCATION).locationKey,client.read(PILAR_LOCATION).locationKey);
});

test('offline and HTTP errors keep stale data and clearly identify old cache', async () => {
  const local=storage();const seeded=createWeatherClient({storage:local,now:()=>now,fetcher:async()=>response(fixture())});await seeded.load(DEFAULT_LOCATION);
  const offline=createWeatherClient({storage:local,now:()=>now+WEATHER_TTL+1,fetcher:async()=>{throw Error('offline');}});
  let emitted;const result=await offline.load(DEFAULT_LOCATION,{onCache:r=>emitted=r});
  assert.ok(emitted);assert.equal(result.source,'offline');assert.equal(result.error,true);
  const weather={now,location:DEFAULT_LOCATION,hour:18,record:result.record,source:'offline',error:true};
  assert.match(weatherPanelMarkup(weather,'2026-09-30'),/Caché anterior|Pronóstico guardado/);
  assert.match(weatherPanelMarkup(weather,'2026-09-30'),/No se pudo actualizar/);
  const httpError=createWeatherClient({storage:local,now:()=>now+WEATHER_TTL+1,fetcher:async()=>({ok:false})});
  assert.equal((await httpError.load(DEFAULT_LOCATION)).source,'offline');
});

test('without cache, API errors reject instead of inventing weather', async () => {
  const client=createWeatherClient({storage:storage(),fetcher:async()=>response({error:true})});
  await assert.rejects(client.load(DEFAULT_LOCATION));
  assert.throws(()=>normalizeForecast({daily:{time:['2026-09-30']}},DEFAULT_LOCATION,now));
});

test('null metrics are never converted to zero or favourable conditions', () => {
  const payload=fixture();payload.hourly.precipitation_probability[0]=null;
  const point=weatherForDate(normalizeForecast(payload,DEFAULT_LOCATION,now),'2026-09-30',18);
  assert.equal(point.rainProbability,null);assert.equal(weatherAssessment(point).level,'unknown');
  const safe=weatherForDate(normalizeForecast(fixture(),DEFAULT_LOCATION,now),'2026-09-30',18);
  assert.equal(weatherAssessment(safe).level,'good');
  assert.equal(weatherAssessment({...safe,code:999}).level,'unknown');
  assert.equal(weatherAssessment({...safe,code:95}).level,'bad');
  assert.equal(weatherAssessment({...safe,feelsLike:35}).level,'bad');
  assert.equal(weatherAssessment({...safe,gust:60}).level,'bad');
  assert.equal(weatherAssessment({...safe,rain:5}).level,'bad');
  assert.equal(weatherAssessment({...safe,feelsLike:28}).level,'caution');
  assert.equal(weatherAssessment({...safe,rainProbability:70}).level,'caution');
});

test('corrupt or unavailable storage is recoverable; quota failure is reported without losing live data', async () => {
  const local=storage();local.setItem('paceup-weather-cache-v1','broken JSON');local.setItem('paceup-weather-preferences-v1','broken');
  assert.equal(readWeatherPreferences(local).location.name,'Buenos Aires');
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};
  const client=createWeatherClient({storage:blocked,now:()=>now,fetcher:async()=>response(fixture())});
  assert.equal((await client.load(DEFAULT_LOCATION)).persisted,false);
  assert.equal((await client.load(DEFAULT_LOCATION)).persisted,false);
  assert.equal(saveWeatherPreferences({hour:12,location:DEFAULT_LOCATION},blocked),false);
  local.setItem('paceup-weather-cache-v1', JSON.stringify({[client.read(DEFAULT_LOCATION).locationKey]:{...client.read(DEFAULT_LOCATION),timezone:'invalid/timezone'}}));
  const recovered=createWeatherClient({storage:local,now:()=>now,fetcher:async()=>response(fixture())});
  assert.equal((await recovered.load(DEFAULT_LOCATION)).source,'network');
});

test('location survives restart but legacy and temporary hours are never restored or saved', () => {
  const local=storage();saveWeatherPreferences({hour:12,location:PILAR_LOCATION},local);
  assert.equal(readWeatherPreferences(local).hour,undefined);assert.equal(readWeatherPreferences(local).location.name,'Pilar · Hebraica');
  assert.equal(JSON.parse(local.getItem('paceup-weather-preferences-v1')).hour,undefined);
  local.setItem('paceup-weather-preferences-v1',JSON.stringify({location:PILAR_LOCATION,hour:4}));
  assert.equal(trainingHourForDate(readWeatherPreferences(local),'2026-10-03'),16);
  saveWeatherPreferences({hour:99,location:{...DEFAULT_LOCATION,latitude:300}},local);
  assert.equal(readWeatherPreferences(local).location.name,'Buenos Aires');
});

test('calendar defaults select the right hourly forecast and overrides stay isolated by date', () => {
  for(const date of ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2027-01-01'])assert.equal(defaultTrainingHour(date),19);
  assert.equal(defaultTrainingHour('2026-10-03'),16);assert.equal(defaultTrainingHour('2026-10-04'),18);
  const record={savedAt:now,timezone:DEFAULT_LOCATION.timezone,days:{
    '2026-10-01':{code:1,max:30,min:12,hours:{19:{temperature:21},12:{temperature:29}}},
    '2026-10-03':{code:1,max:30,min:12,hours:{16:{temperature:23},12:{temperature:28}}}
  }};
  assert.equal(weatherForDate(record,'2026-10-01').temperature,21);
  assert.equal(weatherForDate(record,'2026-10-03').temperature,23);
  const weather={record,location:DEFAULT_LOCATION,now,hourOverrides:{'2026-10-03':12}};
  assert.equal(trainingHourForDate(weather,'2026-10-01'),19);
  assert.match(weatherPanelMarkup(weather,'2026-10-03'),/12:00 · hora del lugar/);
  assert.match(dayWeatherMarkup(weather,'2026-10-03'),/28°/);
  assert.match(weatherPanelMarkup(weather,'2026-10-01'),/19:00 · hora del lugar/);
  assert.equal(trainingHourForDate({hourOverrides:{'2026-10-03':99}},'2026-10-03'),16);
});

test('retained predictions stay labeled as predictions and cache stays bounded per location', async () => {
  const local=storage();let clock=now;
  const client=createWeatherClient({storage:local,now:()=>clock,fetcher:async()=>response(fixture())});
  await client.load(DEFAULT_LOCATION);clock+=86400000;
  const next=fixture();next.daily.time=['2026-10-01','2026-10-02'];next.hourly.time=[];
  const later=createWeatherClient({storage:local,now:()=>clock,fetcher:async()=>response(next)});
  const result=await later.load(DEFAULT_LOCATION);
  assert.equal(weatherForDate(result.record,'2026-09-30',18).capturedAt,now);
  for(let i=0;i<4;i++)await later.load({...DEFAULT_LOCATION,latitude:-30-i});
  assert.equal(Object.keys(JSON.parse(local.getItem('paceup-weather-cache-v1'))).length,3);
});

test('unavailable dates and escaped location names render clearly without nested buttons', () => {
  const weather={now,location:{...DEFAULT_LOCATION,name:'<script>ciudad</script>'},hour:18,record:normalizeForecast(fixture(),DEFAULT_LOCATION,now),source:'cache'};
  const html=weatherPanelMarkup(weather,'2027-01-01',{controls:true});
  assert.match(html,/Todavía sin pronóstico/);assert.match(html,/&lt;script&gt;/);assert.equal(html.includes('<script>'),false);
  assert.match(dayWeatherMarkup(weather,'2027-01-01'),/Sin pronóstico aún/);
  assert.equal(dayWeatherMarkup(weather,'2026-09-30').includes('<button'),false);
});

test('stale offline forecast does not give a favourable verdict for a future outing', () => {
  const record=normalizeForecast(fixture(),DEFAULT_LOCATION,now);
  const html=weatherPanelMarkup({now,location:DEFAULT_LOCATION,hour:18,record,source:'offline'},'2026-10-01');
  assert.match(html,/Pronóstico anterior/);
  assert.equal(html.includes('Mejor bajo techo'),false); // Current verdict is withheld; explanation still lists thresholds.
  assert.match(html,/Actualizá el clima/);
});
