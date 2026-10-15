import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSemantic, captureDigest, deliveryDigest, validateToolEnvelope, canonicalJSON, canonicalDigest } from './semantic-validator.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const GOLDEN_VECTORS=JSON.parse(readFileSync(new URL('./canonical-golden-vectors.json',import.meta.url),'utf8'));

const SHA = c => c.repeat(40);
const clone = x => structuredClone(x);
function syncAcquisition(f) {
  f.snapshot.evidence_ledger_digest=captureDigest(f.snapshot);
}
function syncDelivery(f) {
  const ev=Object.entries(f.ledger);
  for(let i=0;i<ev.length;i++){
    ev[i][1].delivery_seq=i+1;
    if(!ev[i][1].exposed_digest)ev[i][1].exposed_digest=(i%9+1).toString().repeat(64);
  }
  f.review.evidence_delivery_epoch=ev.length;
  f.live.evidence_delivery_epoch=ev.length;
  f.review.evidence_ledger_digest=deliveryDigest(f.ledger,f.snapshot);
  f.live.evidence_ledger_digest=f.review.evidence_ledger_digest;
}

function file(path='a.ts') {
  return {path, previous_path:null, status:'modified', scope:'INCLUDED',
    patch_available:true,patch_sha256:'f'.repeat(64),binary:false,
    additions:3,deletions:2,line_map_available:true,content_state:'AVAILABLE',scope_reason:null};
}
function fixture() {
  const snapshot = {
    schema_version:'0.2.0', snapshot_id:'sha256:fixture', repository_id:'repo:1',
    repository:'sample/project',pull_request_number:1, base_sha:SHA('a'),
    head_sha:SHA('b'),merge_base_sha:SHA('c'),selection_policy_id:'default-v1',
    state:'READY',created_at:'2026-10-16T00:00:00Z',files:[file('a.ts'),file('b.ts')],
    evidence_coverage:{reported_changed_files:2,enumerated_changed_files:2,
      included:2,excluded_by_policy:0,unavailable:0,excluded_reasons:[],
      diff_integrity:'VERIFIED',line_anchor_integrity:'VERIFIED',
      manifest_digest:'d'.repeat(64)},
    evidence_ledger_digest:'e'.repeat(64),limitations:[]
  };
  const review = {
    schema_version:'0.2.0',snapshot_id:snapshot.snapshot_id,model_family:'chatgpt',
    review_policy:'review-policy-v0.2',review_status:'COMPLETE',
    head_sha:snapshot.head_sha,base_sha:snapshot.base_sha,merge_base_sha:snapshot.merge_base_sha,
    reviewed_paths:['a.ts','b.ts'],review_attestations:[
      {path:'a.ts',review_proof_refs:['ev-a'],reviewed_scope:'all',analysis_complete:true},
      {path:'b.ts',review_proof_refs:['ev-b'],reviewed_scope:'all',analysis_complete:true}
    ],findings:[],limitations:[],evidence_ledger_digest:'e'.repeat(64)
  };
  const live={head_sha:snapshot.head_sha,base_sha:snapshot.base_sha,
    merge_base_sha:snapshot.merge_base_sha,repository_id:snapshot.repository_id,
    evidence_ledger_digest:review.evidence_ledger_digest};
  const ledger={
    'ev-a':{delivered:true,path:'a.ts',snapshot_id:snapshot.snapshot_id,
      head_sha:snapshot.head_sha,redaction_state:'NONE'},
    'ev-b':{delivered:true,path:'b.ts',snapshot_id:snapshot.snapshot_id,
      head_sha:snapshot.head_sha,redaction_state:'NONE'}
  };
  const f={snapshot,review,live,ledger};syncAcquisition(f);syncDelivery(f);return f;
}
const defaultFinding = () => ({
  finding_id:'F-1',title:'Defect',severity:'high',category:'correctness',
  verification:'PENDING_VERIFICATION',lifecycle:'ACTIVE',failure_scenario:'input X',
  causal_chain:'X -> Y',impact:'Y',recommendation:'Guard X',
  root_cause_key:'INPUT_GUARD',trigger_class:'INVALID_INPUT',evidence:[]
});
function run(label,mutate,valid,reason) {
  test(label,()=>{
    const f=fixture(); mutate(f);
    const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
    assert.equal(result.valid,valid,JSON.stringify(result));
    if (reason) assert.ok(result.reason_codes.includes(reason),JSON.stringify(result));
    if (valid) assert.equal(result.review_status,'COMPLETE');
  });
}
function addFileSpan(f, changes={}) {
  const anchor = {kind:'FILE_SPAN',path:'a.ts',head_sha:f.snapshot.head_sha,
    ref_side:'HEAD',start_line:2,end_line:5,evidence_ref:'ev-span',
    redaction_state:'NONE',...changes};
  f.review.findings = [{...defaultFinding(),evidence:[anchor]}];
  f.ledger['ev-span']={kind:'FILE_SPAN',delivered:true,path:'a.ts',
    snapshot_id:f.snapshot.snapshot_id,head_sha:f.snapshot.head_sha,
    commit_sha:f.snapshot.head_sha,ref_side:'HEAD',total_lines:100,
    delivered_start_line:1,delivered_end_line:10,
    exposed_digest:'f'.repeat(64),redaction_state:'NONE'};
  syncDelivery(f);
  return anchor;
}
function addDiff(f,side='LEFT',changes={}) {
  const anchor={kind:'DIFF_LINE',path:'a.ts',previous_path:f.snapshot.files[0].previous_path,
    head_sha:f.snapshot.head_sha,side,line:4,hunk_id:'hunk-a',evidence_ref:'ev-diff',
    redaction_state:'NONE',...changes};
  f.review.findings=[{...defaultFinding(),evidence:[anchor]}];
  f.ledger['ev-diff']={kind:'DIFF_LINE',delivered:true,path:'a.ts',
    old_path:f.snapshot.files[0].previous_path ?? 'a.ts',
    snapshot_id:f.snapshot.snapshot_id,head_sha:f.snapshot.head_sha,side,line:4,
    hunk_id:'hunk-a',commit_sha:side==='LEFT'?f.snapshot.merge_base_sha:f.snapshot.head_sha,
    delivered_start_line:2,delivered_end_line:7,redaction_state:'NONE'};
  syncAcquisition(f);
  syncDelivery(f);
  return anchor;
}
function addPr(f,changes={}) {
  const anchor={kind:'PR_LEVEL',head_sha:f.snapshot.head_sha,evidence_ref:'ev-pr',
    summary:'Cross-file inconsistency',source_type:'CROSS_FILE',redaction_state:'NONE',...changes};
  f.review.findings=[{...defaultFinding(),evidence:[anchor]}];
  f.ledger['ev-pr']={kind:'PR_LEVEL',source_type:'CROSS_FILE',delivered:true,
    snapshot_id:f.snapshot.snapshot_id,head_sha:f.snapshot.head_sha,redaction_state:'NONE'};
  syncDelivery(f);
  return anchor;
}

run('schema-valid and semantically COMPLETE fixture',()=>{},true);
run('schema-invalid snapshot missing required repository',f=>{delete f.snapshot.repository},false,'SCHEMA_SNAPSHOT_INVALID');
run('schema-invalid review missing model_family',f=>{delete f.review.model_family},false,'SCHEMA_REVIEW_INVALID');
run('schema-invalid snapshot extra top-level field',f=>{f.snapshot.extra='x'},false,'SCHEMA_SNAPSHOT_INVALID');
run('schema-invalid review extra top-level field',f=>{f.review.extra='x'},false,'SCHEMA_REVIEW_INVALID');
run('schema-invalid type for reviewed_paths',f=>{f.review.reviewed_paths='a.ts'},false,'SCHEMA_REVIEW_INVALID');
run('schema-invalid missing file field',f=>{delete f.snapshot.files[0].content_state},false,'SCHEMA_SNAPSHOT_INVALID');
run('schema-invalid bad date-time format',f=>{f.snapshot.created_at='not a date'},false,'SCHEMA_SNAPSHOT_INVALID');
run('reported=100 enumerated=2',f=>{f.snapshot.evidence_coverage.reported_changed_files=100},false,'MANIFEST_COUNT_MISMATCH');
run('missing review attestations',f=>{f.review.review_attestations=[]},false,'ATTESTATION_SET_MISMATCH');
run('no reviewed files although COMPLETE',f=>{f.review.reviewed_paths=[];f.review.review_attestations=[]},false,'REVIEW_SCOPE_GAP');
run('unknown evidence ref in attestation',f=>{f.review.review_attestations[0].review_proof_refs=['fake']},false,'ATTESTATION_EVIDENCE_INVALID');
run('duplicate manifest path',f=>{f.snapshot.files[1].path='a.ts'},false,'DUPLICATE_MANIFEST_PATH');
run('excluded file',f=>{f.snapshot.files[1].scope='EXCLUDED_BY_POLICY';f.snapshot.files[1].scope_reason='generated';f.snapshot.evidence_coverage.excluded_by_policy=1;f.snapshot.evidence_coverage.included=1},false,'INCOMPLETE_SELECTION');
run('unavailable file',f=>{f.snapshot.files[1].scope='UNAVAILABLE';f.snapshot.files[1].scope_reason='missing';f.snapshot.evidence_coverage.unavailable=1;f.snapshot.evidence_coverage.included=1},false,'INCOMPLETE_SELECTION');
run('unverified diff',f=>{f.snapshot.evidence_coverage.diff_integrity='UNVERIFIED'},false,'UNVERIFIED_DIFF_OR_ANCHORS');
run('HEAD force pushed',f=>{f.live.head_sha=SHA('f')},false,'STALE_BASELINE');
run('base moved despite same merge base',f=>{f.live.base_sha=SHA('f')},false,'STALE_BASELINE');
run('merge base moved',f=>{f.live.merge_base_sha=SHA('f')},false,'STALE_BASELINE');
run('ledger digest mismatch',f=>{f.review.evidence_ledger_digest='f'.repeat(64)},false,'DELIVERY_DIGEST_MISMATCH');
run('review attestation ref blocked',f=>{f.ledger['ev-a'].redaction_state='BLOCKED'},false,'ATTESTATION_EVIDENCE_INVALID');
run('snapshot not READY',f=>{f.snapshot.state='PARTIAL'},false,'SNAPSHOT_NOT_READY');
run('undisclosed limitation',f=>{f.snapshot.limitations.push('CI unavailable')},false,'UNRESOLVED_LIMITATIONS');
run('PR_LEVEL correctly omits path and line',f=>{addPr(f)},true);
run('PR_LEVEL path fabricated',f=>{addPr(f,{path:'invented.ts'})},false,'SCHEMA_REVIEW_INVALID');
run('FILE_SPAN within actually delivered span',f=>{addFileSpan(f)},true);
run('FILE_SPAN reverse interval',f=>{addFileSpan(f,{start_line:20,end_line:10})},false,'FILE_SPAN_INVALID');
run('FILE_SPAN outside delivered 1-10, inside file 1-100',f=>{addFileSpan(f,{start_line:50,end_line:60})},false,'FILE_SPAN_INVALID');
run('FILE_SPAN prior commit mismatch',f=>{addFileSpan(f);f.ledger['ev-span'].commit_sha=SHA('e')},false,'FILE_SPAN_INVALID');
// Invalid delivered-event digest is rejected at the sealed ledger boundary BEFORE anchor checking.
run('FILE_SPAN unverified exposed digest',f=>{addFileSpan(f);f.ledger['ev-span'].exposed_digest=null},false,'DELIVERY_LEDGER_INVALID');
run('normal modified file valid LEFT with previous_path null',f=>{addDiff(f,'LEFT')},true);
run('normal modified file valid RIGHT',f=>{addDiff(f,'RIGHT')},true);
run('deleted file valid LEFT with previous_path null',f=>{f.snapshot.files[0].status='removed';addDiff(f,'LEFT')},true);
run('deleted file invalid RIGHT',f=>{f.snapshot.files[0].status='removed';addDiff(f,'RIGHT')},false,'DIFF_ANCHOR_INVALID');
run('added file invalid LEFT',f=>{f.snapshot.files[0].status='added';addDiff(f,'LEFT')},false,'DIFF_ANCHOR_INVALID');
run('renamed file valid LEFT old path',f=>{f.snapshot.files[0].status='renamed';f.snapshot.files[0].previous_path='old-a.ts';addDiff(f,'LEFT')},true);
run('renamed file valid RIGHT new path',f=>{f.snapshot.files[0].status='renamed';f.snapshot.files[0].previous_path='old-a.ts';addDiff(f,'RIGHT')},true);
run('renamed file mismatch previous_path',f=>{f.snapshot.files[0].status='renamed';f.snapshot.files[0].previous_path='old-a.ts';addDiff(f,'LEFT',{previous_path:'wrong.ts'})},false,'DIFF_ANCHOR_INVALID');
run('LEFT anchor wrong immutable preimage commit',f=>{addDiff(f,'LEFT');f.ledger['ev-diff'].commit_sha=f.snapshot.head_sha},false,'DIFF_ANCHOR_INVALID');
run('RIGHT anchor not present in delivered hunk span',f=>{addDiff(f,'RIGHT',{line:95})},false,'DIFF_ANCHOR_INVALID');
run('DIFF_LINE right/left mismatch',f=>{addDiff(f,'LEFT',{side:'RIGHT'})},false,'DIFF_ANCHOR_INVALID');
run('masked source cannot prove CONFIRMED_SOURCE',f=>{addPr(f,{redaction_state:'REDACTED'});f.ledger['ev-pr'].redaction_state='REDACTED';f.review.findings[0].verification='CONFIRMED_SOURCE'},false,'MASKED_SOLE_EVIDENCE');
run('reference validator cannot prove runtime execution',f=>{addPr(f);f.review.findings[0].verification='CONFIRMED_RUNTIME'},false,'UNSUPPORTED_RUNTIME_ASSERTION');
run('model cannot self-authorize RESOLVED',f=>{addPr(f);f.review.findings[0].lifecycle='RESOLVED'},false,'LIFECYCLE_REQUIRES_REGISTRY');


// R2-IR-NEW-001: two digest domains and a versioned delivery-event epoch.
run('three simultaneously null digests must NEVER accept COMPLETE',f=>{
  f.snapshot.evidence_ledger_digest=null;
  f.review.evidence_ledger_digest=null;
  f.live.evidence_ledger_digest=null;
},false,'SCHEMA_SNAPSHOT_INVALID');
run('null acquisition digest forbidden at READY',f=>{
  f.snapshot.evidence_ledger_digest=null;
},false,'SCHEMA_SNAPSHOT_INVALID');
run('null proposed delivery digest forbidden at COMPLETE',f=>{
  f.review.evidence_ledger_digest=null;
},false,'SCHEMA_REVIEW_INVALID');
run('trusted live delivery digest null forbidden',f=>{
  f.live.evidence_ledger_digest=null;
},false,'MISSING_DELIVERY_DIGEST');
run('arbitrary but matching digest values are NOT sufficient',f=>{
  f.review.evidence_ledger_digest='f'.repeat(64);
  f.live.evidence_ledger_digest='f'.repeat(64);
},false,'DELIVERY_DIGEST_MISMATCH');
run('acquisition capture digest tampering denied',f=>{
  f.snapshot.evidence_ledger_digest='a'.repeat(64);
},false,'ACQUISITION_DIGEST_MISMATCH');
run('delivery epoch is bound to submitted report',f=>{
  f.review.evidence_delivery_epoch=999;
},false,'DELIVERY_EPOCH_MISMATCH');
run('new delivery event after review cannot silently pass at old epoch',f=>{
  f.ledger['ev-late']={delivered:true,path:'a.ts',snapshot_id:f.snapshot.snapshot_id,
    head_sha:f.snapshot.head_sha,redaction_state:'NONE',delivery_seq:3,
    exposed_digest:'9'.repeat(64)};
},false,'DELIVERY_EPOCH_MISMATCH');
run('missing delivery event sequence rejected',f=>{
  f.ledger['ev-b'].delivery_seq=7;
},false,'DELIVERY_LEDGER_INVALID');
run('delivered byte digest mutation rejected',f=>{
  f.ledger['ev-a'].exposed_digest='f'.repeat(64);
},false,'DELIVERY_DIGEST_MISMATCH');

function envelopeFixture() {
  const snapshotId='sha256:fixture';
  const receipt={
    schema_version:'0.2.0',validation_id:'val:fixture',snapshot_id:snapshotId,
    snapshot_manifest_digest:'d'.repeat(64),result_digest:'e'.repeat(64),
    review_status:'COMPLETE',valid:true,reason_codes:[],verified_reviewed_files:2,
    verified_eligible_files:2,checked_current_head_sha:SHA('b'),
    checked_current_base_sha:SHA('a'),checked_current_merge_base_sha:SHA('c'),
    verified_at:'2026-10-16T00:00:00Z',finding_identities:[],signature:null
  };
  return {
    schema_version:'0.2.0',request_id:'req:fixture',snapshot_id:snapshotId,
    status:'SUCCESS',provenance:[{source:'server',resource:'receipt'}],
    limitations:[],result:receipt
  };
}
test('R2-IR-NEW-002: matching Envelope/Receipt Snapshot ID accepted',()=>{
  const e=envelopeFixture();
  const x=validateToolEnvelope(e,'sha256:fixture','req:fixture');
  assert.equal(x.valid,true,JSON.stringify(x));
  assert.equal(x.complete,true);
});
test('R2-IR-NEW-002: structurally valid but mismatched inner snapshot REJECTED',()=>{
  const e=envelopeFixture();e.result.snapshot_id='snapshot-B';
  const x=validateToolEnvelope(e,'sha256:fixture','req:fixture');
  assert.equal(x.valid,false);
  assert.ok(x.reason_codes.includes('ENVELOPE_RECEIPT_SNAPSHOT_MISMATCH'));
  assert.equal(x.complete,false);
});
test('R2-IR-NEW-002: wrong outer snapshot versus expected request REJECTED',()=>{
  const e=envelopeFixture();e.snapshot_id='snapshot-B';
  const x=validateToolEnvelope(e,'sha256:fixture','req:fixture');
  assert.equal(x.valid,false);
  assert.ok(x.reason_codes.includes('ENVELOPE_RECEIPT_SNAPSHOT_MISMATCH'));
});
test('R2-IR-NEW-002: wrong request nonce REJECTED',()=>{
  const e=envelopeFixture();
  const x=validateToolEnvelope(e,'sha256:fixture','req:other');
  assert.equal(x.valid,false);
  assert.ok(x.reason_codes.includes('ENVELOPE_REQUEST_ID_MISMATCH'));
});
test('R2-IR-NEW-002: schema-invalid envelope FAIL CLOSED',()=>{
  const e=envelopeFixture();delete e.request_id;
  const x=validateToolEnvelope(e,'sha256:fixture','req:fixture');
  assert.equal(x.valid,false);
  assert.ok(x.reason_codes.includes('SCHEMA_ENVELOPE_INVALID'));
});
test('PARTIAL Receipt can be valid envelope but never COMPLETE',()=>{
  const e=envelopeFixture();
  e.result.review_status='PARTIAL';
  e.result.valid=false;
  e.result.reason_codes=['REVIEW_SCOPE_GAP'];
  const x=validateToolEnvelope(e,'sha256:fixture','req:fixture');
  assert.equal(x.valid,true,JSON.stringify(x));
  assert.equal(x.complete,false);
});


// R2-IR-NEW-003: all schema Snapshot fields and full delivery-event metadata.
test('capture digest protects PR identity and every file/coverage property',()=>{
  const cases=[
    ['pull_request_number',f=>f.snapshot.pull_request_number=2],
    ['repository',f=>f.snapshot.repository='other/repository'],
    ['repository_id',f=>f.snapshot.repository_id='repo:2'],
    ['snapshot_id',f=>f.snapshot.snapshot_id='sha256:other'],
    ['selection_policy_id',f=>f.snapshot.selection_policy_id='other'],
    ['base_sha',f=>f.snapshot.base_sha=SHA('d')],
    ['head_sha',f=>f.snapshot.head_sha=SHA('e')],
    ['merge_base_sha',f=>f.snapshot.merge_base_sha=SHA('f')],
    ['state',f=>f.snapshot.state='PARTIAL'],
    ['created_at',f=>f.snapshot.created_at='2026-10-17T00:00:00Z'],
    ['file.path',f=>f.snapshot.files[0].path='new-a.ts'],
    ['file.previous_path',f=>f.snapshot.files[0].previous_path='old-a.ts'],
    ['file.status',f=>f.snapshot.files[0].status='renamed'],
    ['file.scope',f=>f.snapshot.files[0].scope='UNAVAILABLE'],
    ['file.patch_available',f=>f.snapshot.files[0].patch_available=false],
    ['file.patch_sha256',f=>f.snapshot.files[0].patch_sha256='a'.repeat(64)],
    ['file.binary',f=>f.snapshot.files[0].binary=true],
    ['file.additions',f=>f.snapshot.files[0].additions=42],
    ['file.deletions',f=>f.snapshot.files[0].deletions=41],
    ['file.line_map_available',f=>f.snapshot.files[0].line_map_available=false],
    ['file.content_state',f=>f.snapshot.files[0].content_state='REDACTED'],
    ['file.scope_reason',f=>f.snapshot.files[0].scope_reason='policy-reason'],
    ['coverage.manifest_digest',f=>f.snapshot.evidence_coverage.manifest_digest='b'.repeat(64)],
    ['coverage.line_anchor_integrity',f=>f.snapshot.evidence_coverage.line_anchor_integrity='PARTIAL'],
    ['coverage.reported_changed_files',f=>f.snapshot.evidence_coverage.reported_changed_files=4],
    ['coverage.excluded_reasons',f=>f.snapshot.evidence_coverage.excluded_reasons.push('policy')],
    ['limitations',f=>f.snapshot.limitations.push('missing source')],
    ['file order',f=>f.snapshot.files.reverse()]
  ];
  for(const [name,mutate] of cases){
    const f=fixture(),sealed=f.snapshot.evidence_ledger_digest;
    mutate(f);
    assert.notEqual(captureDigest(f.snapshot),sealed,name+' unprotected');
    const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
    assert.equal(result.valid,false,name+' accepted COMPLETE');
    assert.ok(result.reason_codes.includes('ACQUISITION_DIGEST_MISMATCH') ||
      result.reason_codes.some(x=>x.startsWith('SCHEMA_')),name+': '+JSON.stringify(result));
  }
});
test('capture digest unaffected by JSON object property order',()=>{
  const f=fixture(),reorder=o=>Object.fromEntries(Object.entries(o).reverse());
  const s=reorder(f.snapshot);
  s.files=f.snapshot.files.map(reorder);
  s.evidence_coverage=reorder(f.snapshot.evidence_coverage);
  assert.equal(captureDigest(s),f.snapshot.evidence_ledger_digest);
});
test('digest field intentionally excluded from self-hash yet mismatches fail',()=>{
  const f=fixture();
  f.snapshot.evidence_ledger_digest='a'.repeat(64);
  assert.equal(captureDigest(f.snapshot),captureDigest(fixture().snapshot));
  const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.ok(result.reason_codes.includes('ACQUISITION_DIGEST_MISMATCH'));
});
test('delivery digest protects complete event payload, not a selected subset',()=>{
  const cases=[
    ['old_path',f=>{addDiff(f,'LEFT');f.ledger['ev-diff'].old_path='forged.ts'}],
    ['total_lines',f=>{addFileSpan(f);f.ledger['ev-span'].total_lines=999}],
    ['commit_sha',f=>{addFileSpan(f);f.ledger['ev-span'].commit_sha=SHA('d')}],
    ['ref_side',f=>{addFileSpan(f);f.ledger['ev-span'].ref_side='BASE'}],
    ['kind',f=>{addFileSpan(f);f.ledger['ev-span'].kind='DIFF_LINE'}],
    ['side',f=>{addDiff(f,'LEFT');f.ledger['ev-diff'].side='RIGHT'}],
    ['hunk_id',f=>{addDiff(f,'LEFT');f.ledger['ev-diff'].hunk_id='other'}],
    ['line',f=>{addDiff(f,'LEFT');f.ledger['ev-diff'].line=99}],
    ['delivered_start_line',f=>{addFileSpan(f);f.ledger['ev-span'].delivered_start_line=3}],
    ['delivered_end_line',f=>{addFileSpan(f);f.ledger['ev-span'].delivered_end_line=4}],
    ['path',f=>f.ledger['ev-a'].path='other.ts'],
    ['redaction_state',f=>f.ledger['ev-a'].redaction_state='REDACTED'],
    ['exposed_digest',f=>f.ledger['ev-a'].exposed_digest='f'.repeat(64)],
    ['delivered',f=>f.ledger['ev-a'].delivered=false],
    ['snapshot_id',f=>f.ledger['ev-a'].snapshot_id='another'],
    ['head_sha',f=>f.ledger['ev-a'].head_sha=SHA('d')],
    ['source_type',f=>{addPr(f);f.ledger['ev-pr'].source_type='CI'}],
    ['delivery_seq',f=>f.ledger['ev-a'].delivery_seq=42],
    ['new event metadata',f=>f.ledger['ev-a'].sensitivity='private']
  ];
  for(const [name,mutate] of cases){
    const f=fixture();mutate(f);
    assert.notEqual(deliveryDigest(f.ledger,f.snapshot),f.review.evidence_ledger_digest,name+' unprotected');
    const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
    assert.equal(r.valid,false,name+' accepted COMPLETE');
    assert.ok(r.reason_codes.includes('DELIVERY_DIGEST_MISMATCH') ||
      r.reason_codes.includes('DELIVERY_LEDGER_INVALID'),name+': '+JSON.stringify(r));
  }
});
test('evidence reference map key replacement is bound to delivered ledger digest',()=>{
  const f=fixture();
  f.ledger['ev-new']=f.ledger['ev-a'];delete f.ledger['ev-a'];
  const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(r.valid,false);
  assert.ok(r.reason_codes.includes('DELIVERY_DIGEST_MISMATCH'));
});
test('spoofed event id field cannot overwrite authoritative evidence_ref key',()=>{
  const f=fixture();f.ledger['ev-a'].id='ev-another';
  assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
  const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.ok(r.reason_codes.includes('DELIVERY_LEDGER_INVALID'));
});
test('delivery digest stable under object and map member order',()=>{
  const f=fixture(),reorder=o=>Object.fromEntries(Object.entries(o).reverse());
  const l=reorder(f.ledger);
  for(const k of Object.keys(l))l[k]=reorder(l[k]);
  assert.equal(deliveryDigest(l,f.snapshot),f.review.evidence_ledger_digest);
});
test('capture digest cannot be substituted for delivery digest',()=>{
  const f=fixture();
  assert.notEqual(f.snapshot.evidence_ledger_digest,f.review.evidence_ledger_digest);
  f.review.evidence_ledger_digest=f.snapshot.evidence_ledger_digest;
  f.live.evidence_ledger_digest=f.snapshot.evidence_ledger_digest;
  const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.ok(r.reason_codes.includes('DELIVERY_DIGEST_MISMATCH'));
});


test('fixed independent UTF-8 canonical byte and SHA-256 golden vectors',()=>{
  // Canonical bytes were handwritten; hash values computed independently by
  // Python hashlib, not produced by canonicalJSON/canonicalDigest under test.
  for(const v of GOLDEN_VECTORS){
    let payload;
    if(v.kind==='plain')payload=v.input;
    else if(v.kind==='capture'){
      const snapshot={...v.input};
      delete snapshot.evidence_ledger_digest;
      payload={digest_domain:'evidiff.capture.v2',digest_encoding:'canonical-json-v2',snapshot};
      assert.equal(captureDigest(v.input),v.expected_sha256,v.name);
    } else if(v.kind==='delivery'){
      const {snapshot,ledger}=v.input;
      const entry={...ledger.ev1,id:'ev1'};
      payload={digest_domain:'evidiff.delivery.v2',digest_encoding:'canonical-json-v2',
        snapshot_id:snapshot.snapshot_id,acquisition_digest:snapshot.evidence_ledger_digest,
        epoch:1,entries:[entry]};
      assert.equal(deliveryDigest(ledger,snapshot),v.expected_sha256,v.name);
    } else assert.fail('unknown golden fixture kind');
    assert.equal(canonicalJSON(payload),v.expected_utf8_text,v.name+' bytes');
    assert.equal(canonicalDigest(payload),v.expected_sha256,v.name+' digest');
    assert.equal(createHash('sha256').update(Buffer.from(v.expected_utf8_text,'utf8')).digest('hex'),
      v.expected_sha256,v.name+' independent hash');
  }
});
test('sparse arrays cannot collide with empty or null arrays',()=>{
  assert.equal(canonicalJSON([]),'[]');
  for(const hole of [Array(1),[,],[1,,3]]){
    assert.throws(()=>canonicalJSON(hole));
    assert.equal(canonicalDigest(hole),null);
  }
  assert.equal(canonicalJSON([null]),'[null]');
  assert.notEqual(canonicalDigest([]),canonicalDigest([null]));
});
test('delivery event nested sparse array fails closed and cannot claim COMPLETE',()=>{
  const f=fixture();
  f.ledger['ev-a'].extra=[];
  syncDelivery(f);
  const sealed=f.review.evidence_ledger_digest;
  f.ledger['ev-a'].extra=Array(1);
  assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
  assert.notEqual(deliveryDigest(f.ledger,f.snapshot),sealed);
  const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(r.valid,false);
  assert.notEqual(r.review_status,'COMPLETE');
  assert.ok(r.reason_codes.includes('DELIVERY_LEDGER_INVALID'),JSON.stringify(r));
});
test('invalid nested arrays in Snapshot cannot produce a valid capture digest',()=>{
  const f=fixture();
  f.snapshot.files[0].extra={invalid:Array(2)};
  assert.equal(captureDigest(f.snapshot),null);
  const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(r.valid,false);
  assert.notEqual(r.review_status,'COMPLETE');
});
test('nested arrays with symbol/accessor/non-index/hidden keys are invalid',()=>{
  for(const mutate of [
    a=>{a.extra='secret';},
    a=>{a[Symbol('secret')]='value';},
    a=>Object.defineProperty(a,'0',{get:()=>42,configurable:true,enumerable:true}),
    a=>Object.defineProperty(a,'0',{value:42,configurable:true,enumerable:false})
  ]){
    const a=[42];
    mutate(a);
    assert.throws(()=>canonicalJSON({nested:{a}}));
    assert.equal(canonicalDigest({nested:{a}}),null);
  }
});
test('non-JSON object getters, symbols, hidden properties, cycles and non-finite values rejected',()=>{
  const accessor={};Object.defineProperty(accessor,'x',{enumerable:true,get:()=>1});
  const hidden={};Object.defineProperty(hidden,'secret',{enumerable:false,value:'x'});
  const symbol={a:1};symbol[Symbol('secret')]='x';
  const cycle={};cycle.self=cycle;
  for(const data of [accessor,hidden,symbol,cycle,{bad:undefined},{num:NaN},{num:Infinity}]){
    assert.throws(()=>canonicalJSON(data));
    assert.equal(canonicalDigest(data),null);
  }
});
test('Snapshot root accessor/nonenumerable field cannot disappear from sealed capture',()=>{
  for(const mutate of [
    obj=>Object.defineProperty(obj,'extra',{get:()=>1,enumerable:true}),
    obj=>Object.defineProperty(obj,'extra',{value:1,enumerable:false}),
    obj=>{obj[Symbol('hidden')]=1;}
  ]){
    const f=fixture();
    mutate(f.snapshot);
    assert.equal(captureDigest(f.snapshot),null);
  }
});
test('delivery event accessor/nonenumerable field cannot disappear from ledger',()=>{
  for(const mutate of [
    obj=>Object.defineProperty(obj,'extra',{get:()=>1,enumerable:true}),
    obj=>Object.defineProperty(obj,'extra',{value:1,enumerable:false}),
    obj=>{obj[Symbol('hidden')]=1;}
  ]){
    const f=fixture();
    mutate(f.ledger['ev-a']);
    assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
    const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
    assert.equal(r.valid,false);
  }
});
test('permuting plain object keys does not change independent golden output',()=>{
  const original=structuredClone(GOLDEN_VECTORS[0].input);
  const reverse=o=>Object.fromEntries(Object.entries(o).reverse());
  const reordered=reverse(original);
  reordered.a=reverse(original.a);
  assert.equal(canonicalJSON(reordered),GOLDEN_VECTORS[0].expected_utf8_text);
  assert.equal(canonicalDigest(reordered),GOLDEN_VECTORS[0].expected_sha256);
});
test('array order changes digest and object member order does not',()=>{
  assert.notEqual(canonicalDigest({items:[null,1]}),canonicalDigest({items:[1,null]}));
  assert.equal(canonicalDigest({z:1,a:null}),canonicalDigest({a:null,z:1}));
});


// F01-NEW-001/002: the root ledger is the trusted boundary, not Object.entries
// on an arbitrary object or bracket lookups through its prototype chain.
test('F01-NEW-001 hidden ledger entry must fail closed',()=>{
  const f=fixture();
  Object.defineProperty(f.ledger,'ghost',{
    value:{...f.ledger['ev-a'],delivery_seq:3},
    enumerable:false
  });
  assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
  const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(result.valid,false);
  assert.notEqual(result.review_status,'COMPLETE');
  assert.ok(result.reason_codes.includes('DELIVERY_LEDGER_INVALID'),JSON.stringify(result));
});
test('F01-NEW-001 inherited evidence cannot prove review completion',()=>{
  const f=fixture();
  Object.setPrototypeOf(f.ledger,{ghost:{...f.ledger['ev-a']}});
  f.review.review_attestations[0].review_proof_refs=['ghost'];
  const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(result.valid,false);
  assert.notEqual(result.review_status,'COMPLETE');
  assert.ok(result.reason_codes.includes('DELIVERY_LEDGER_INVALID'),JSON.stringify(result));
});
test('F01-NEW-001 prototype member name cannot substitute for own evidence ref',()=>{
  const f=fixture();
  f.review.review_attestations[0].review_proof_refs=['toString'];
  const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(result.valid,false);
  assert.notEqual(result.review_status,'COMPLETE');
  assert.ok(result.reason_codes.includes('ATTESTATION_EVIDENCE_INVALID'),JSON.stringify(result));
});
test('F01-NEW-001 inherited PR_LEVEL evidence cannot validate a finding',()=>{
  const f=fixture();
  addPr(f);
  const copy={...f.ledger['ev-pr']};
  delete f.ledger['ev-pr'];
  Object.setPrototypeOf(f.ledger,{ghost:copy});
  f.review.findings[0].evidence[0].evidence_ref='ghost';
  const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(result.valid,false);
  assert.notEqual(result.review_status,'COMPLETE');
  assert.ok(result.reason_codes.includes('DELIVERY_LEDGER_INVALID'),JSON.stringify(result));
});
test('F01-NEW-001 Symbol ledger key cannot be silently omitted',()=>{
  const f=fixture();
  f.ledger[Symbol('hidden')]={...f.ledger['ev-a'],delivery_seq:3};
  assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
  const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(r.valid,false);
  assert.ok(r.reason_codes.includes('DELIVERY_LEDGER_INVALID'),JSON.stringify(r));
});
test('F01-NEW-002 enumerable root getter must not execute, including throwing getter',()=>{
  for(const type of ['return','throw']){
    const f=fixture();
    let calls=0;
    Object.defineProperty(f.ledger,'ghost',{
      enumerable:true,
      get(){
        calls++;
        if(type==='throw')throw new Error('root getter executed');
        return {...f.ledger['ev-a'],delivery_seq:3};
      }
    });
    assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
    const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
    assert.equal(result.valid,false);
    assert.notEqual(result.review_status,'COMPLETE');
    assert.ok(result.reason_codes.includes('DELIVERY_LEDGER_INVALID'),JSON.stringify(result));
    assert.equal(calls,0,'root getter was executed');
  }
});
test('F01-NEW-002 nonenumerable root getter cannot be ignored or evaluated',()=>{
  const f=fixture();let calls=0;
  Object.defineProperty(f.ledger,'ghost',{enumerable:false,get(){calls++;return f.ledger['ev-a'];}});
  assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
  const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(r.valid,false);
  assert.equal(calls,0);
});
test('F01-NEW-001 abnormal root prototype rejected even without a ghost member',()=>{
  const f=fixture();
  Object.setPrototypeOf(f.ledger,{});
  assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
  const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.ok(r.reason_codes.includes('DELIVERY_LEDGER_INVALID'),JSON.stringify(r));
});
test('F01-NEW-001 legitimate null-prototype root ledger remains accepted',()=>{
  const f=fixture();
  f.ledger=Object.assign(Object.create(null),f.ledger);
  const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(result.valid,true,JSON.stringify(result));
  assert.equal(result.review_status,'COMPLETE');
  assert.equal(deliveryDigest(f.ledger,f.snapshot),f.review.evidence_ledger_digest);
});
test('F01-NEW-001 modifying own sealed event still invalidates review',()=>{
  const f=fixture();
  const captured=f.review.evidence_ledger_digest;
  f.ledger['ev-a'].delivered_start_line=42;
  assert.notEqual(deliveryDigest(f.ledger,f.snapshot),captured);
  const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(r.valid,false);
  assert.ok(r.reason_codes.includes('DELIVERY_DIGEST_MISMATCH'),JSON.stringify(r));
});


// F01-R3-NEW-001 — nested accessor coercion before canonical validation.
test('T13 delivery_seq.valueOf getter is never invoked by sorting',()=>{
  const f=fixture();
  let calls=0;
  f.ledger['ev-a'].delivery_seq={
    get valueOf(){calls++;return ()=>1;}
  };
  assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
  const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(result.valid,false,JSON.stringify(result));
  assert.notEqual(result.review_status,'COMPLETE');
  assert.ok(result.reason_codes.includes('DELIVERY_LEDGER_INVALID'),JSON.stringify(result));
  assert.equal(calls,0,'delivery_seq.valueOf getter executed');
});
test('T14 exposed_digest.toString getter is never invoked by regexp',()=>{
  const f=fixture();
  let calls=0;
  f.ledger['ev-a'].exposed_digest={
    get toString(){calls++;return ()=>'a'.repeat(64);}
  };
  assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
  const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(result.valid,false,JSON.stringify(result));
  assert.notEqual(result.review_status,'COMPLETE');
  assert.ok(result.reason_codes.includes('DELIVERY_LEDGER_INVALID'),JSON.stringify(result));
  assert.equal(calls,0,'exposed_digest.toString getter executed');
});
test('nested accessor converting via Symbol.toPrimitive is not called',()=>{
  const f=fixture();
  let calls=0;
  f.ledger['ev-b'].delivery_seq={
    get [Symbol.toPrimitive](){calls++;return ()=>2;}
  };
  const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
  assert.equal(result.valid,false,JSON.stringify(result));
  assert.ok(result.reason_codes.includes('DELIVERY_LEDGER_INVALID'));
  assert.equal(calls,0,'Symbol.toPrimitive getter executed');
});
test('non-string exposed digest with callable coercion is rejected without invocation',()=>{
  for(const setup of [
    c=>({valueOf(){c.n++;return 'b'.repeat(64)}}),
    c=>({toString(){c.n++;return 'b'.repeat(64)}}),
    c=>({get toString(){c.n++;throw Error('getter must not run')}})
  ]){
    const f=fixture(),calls={n:0};
    f.ledger['ev-b'].exposed_digest=setup(calls);
    assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
    const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
    assert.equal(result.valid,false);
    assert.ok(result.reason_codes.includes('DELIVERY_LEDGER_INVALID'));
    assert.equal(calls.n,0,'coercion function/accessor was invoked');
  }
});
test('delivery_seq strings, fractional numbers and unsafe integers fail closed',()=>{
  for(const invalid of ['1',1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,null]){
    const f=fixture();
    f.ledger['ev-a'].delivery_seq=invalid;
    assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
    const result=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
    assert.equal(result.valid,false);
    assert.ok(result.reason_codes.includes('DELIVERY_LEDGER_INVALID'));
  }
});
test('nested extra metadata getters are rejected before sorting or regex',()=>{
  for(const field of ['valueOf','toString']){
    const f=fixture();let calls=0;
    Object.defineProperty(f.ledger['ev-a'],'metadata',{
      value:{get [field](){calls++;return ()=>1;}},
      configurable:true,enumerable:true
    });
    assert.equal(deliveryDigest(f.ledger,f.snapshot),null);
    const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
    assert.equal(r.valid,false);
    assert.ok(r.reason_codes.includes('DELIVERY_LEDGER_INVALID'));
    assert.equal(calls,0,'nested metadata getter invoked');
  }
});
