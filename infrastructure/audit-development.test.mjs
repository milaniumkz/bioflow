import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAudit } from './audit-development.mjs';
const advisory={severity:'high',url:'https://github.com/advisories/GHSA-fc5q-39xc-vjpf'};
function fixture(){return {report:{metadata:{vulnerabilities:{high:2}},vulnerabilities:{picomatch:{severity:'high',via:[advisory],nodes:['node_modules/picomatch']},tool:{severity:'high',via:['picomatch'],nodes:['node_modules/tool']}}},lock:{packages:{'node_modules/picomatch':{dev:true},'node_modules/tool':{dev:true}}}}}
const current=Date.parse('2026-11-18T00:00:00Z');
test('temporarily permits the exact unpatched advisory and its development-only dependants',()=>{const f=fixture();assert.deepEqual(assessAudit(f.report,f.lock,current).blocked,[])});
test('never permits the same advisory in a production dependency',()=>{const f=fixture();f.lock.packages['node_modules/picomatch'].dev=false;assert.deepEqual(assessAudit(f.report,f.lock,current).blocked,['picomatch','tool'])});
test('never permits any unrelated high advisory',()=>{const f=fixture();f.report.vulnerabilities.picomatch.via.push({severity:'high',url:'https://github.com/advisories/OTHER'});assert.deepEqual(assessAudit(f.report,f.lock,current).blocked,['picomatch','tool'])});
test('the exception expires and cannot conceal critical severity',()=>{const f=fixture();assert.equal(assessAudit(f.report,f.lock,Date.parse('2026-12-02T00:00:00Z')).blocked.length,2);f.report.vulnerabilities.picomatch.severity='critical';assert(assessAudit(f.report,f.lock,current).blocked.includes('picomatch'))});
test('unknown dependency paths, missing audit data and registry failures fail closed',()=>{const f=fixture();delete f.lock.packages['node_modules/picomatch'];assert.equal(assessAudit(f.report,f.lock,current).blocked.length,2);assert.throws(()=>assessAudit({},f.lock,current));assert.throws(()=>assessAudit({...f.report,error:{code:'ENETWORK'}},f.lock,current))});
