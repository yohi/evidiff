import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSemantic } from './semantic-validator.mjs';

const S = (x) => x.repeat(40);
const copy = (x) => JSON.parse(JSON.stringify(x));
function fixture() {
  const snapshot={schema_version:'0.2.0',snapshot_id:'sha256:test',repository_id:'repo:1',
    head_sha:S('b'),base_sha:S('a'),merge_base_sha:S('c'),state:'READY',limitations:[],
    files:[{path:'a.ts',scope:'INCLUDED'},{path:'b.ts',scope:'INCLUDED'}],
    evidence_coverage:{reported_changed_files:2,enumerated_changed_files:2,included:2,excluded_by_policy:0,unavailable:0,
      diff_integrity:'VERIFIED',line_anchor_integrity:'VERIFIED',manifest_digest:'d'.repeat(64)}};
  const review={schema_version:'0.2.0',review_policy:'review-policy-v0.2',snapshot_id:snapshot.snapshot_id,
    head_sha:snapshot.head_sha,base_sha:snapshot.base_sha,merge_base_sha:snapshot.merge_base_sha,review_status:'COMPLETE',
    reviewed_paths:['a.ts','b.ts'],review_attestations:[
      {path:'a.ts',review_proof_refs:['ev-a'],analysis_complete:true,reviewed_scope:'all'},
      {path:'b.ts',review_proof_refs:['ev-b'],analysis_complete:true,reviewed_scope:'all'}],
    findings:[],limitations:[],evidence_ledger_digest:'e'.repeat(64)};
  const live={head_sha:snapshot.head_sha,base_sha:snapshot.base_sha,merge_base_sha:snapshot.merge_base_sha,
    repository_id:snapshot.repository_id,evidence_ledger_digest:review.evidence_ledger_digest};
  const ledger={'ev-a':{delivered:true,path:'a.ts',snapshot_id:snapshot.snapshot_id,head_sha:snapshot.head_sha,redaction_state:'NONE'},
    'ev-b':{delivered:true,path:'b.ts',snapshot_id:snapshot.snapshot_id,head_sha:snapshot.head_sha,redaction_state:'NONE'}};
  return {snapshot,review,live,ledger};
}
function run(name, mutate, accepted=false, reason) {
  test(name,()=>{
    const f=fixture();mutate(f);
    const r=validateSemantic(f.snapshot,f.review,f.live,f.ledger);
    assert.equal(r.valid,accepted);
    if(reason)assert.ok(r.reason_codes.includes(reason),JSON.stringify(r));
  });
}
run('COMPLETE requires all attested verified paths',()=>{},true);
run('100 reported but 2 enumerated',f=>{f.snapshot.evidence_coverage.reported_changed_files=100},false,'MANIFEST_COUNT_MISMATCH');
run('model falsely claims reviewed without attestations',f=>{f.review.review_attestations=[]},false,'ATTESTATION_SET_MISMATCH');
run('model did not inspect included files',f=>{f.review.reviewed_paths=[];f.review.review_attestations=[]},false,'REVIEW_SCOPE_GAP');
run('a fabricated evidence ref',f=>{f.review.review_attestations[0].review_proof_refs=['missing']},false,'ATTESTATION_EVIDENCE_INVALID');
run('manifest duplicate',f=>{f.snapshot.files[1].path='a.ts'},false,'DUPLICATE_MANIFEST_PATH');
run('excluded file',f=>{f.snapshot.files[1].scope='EXCLUDED_BY_POLICY';f.snapshot.evidence_coverage.included=1;f.snapshot.evidence_coverage.excluded_by_policy=1},false,'INCOMPLETE_SELECTION');
run('unavailable file',f=>{f.snapshot.files[1].scope='UNAVAILABLE';f.snapshot.evidence_coverage.included=1;f.snapshot.evidence_coverage.unavailable=1},false,'INCOMPLETE_SELECTION');
run('unverified diff',f=>{f.snapshot.evidence_coverage.diff_integrity='UNVERIFIED'},false,'UNVERIFIED_DIFF_OR_ANCHORS');
run('head force push',f=>{f.live.head_sha=S('f')},false,'STALE_BASELINE');
run('base moved but merge base did not',f=>{f.live.base_sha=S('f')},false,'STALE_BASELINE');
run('merge base moved',f=>{f.live.merge_base_sha=S('f')},false,'STALE_BASELINE');
run('wrong ledger hash',f=>{f.review.evidence_ledger_digest='f'.repeat(64)},false,'LEDGER_DIGEST_MISMATCH');
run('redaction blocked review proof',f=>{f.ledger['ev-a'].redaction_state='BLOCKED'},false,'ATTESTATION_EVIDENCE_INVALID');
run('missing snapshot READY',f=>{f.snapshot.state='PARTIAL'},false,'SNAPSHOT_NOT_READY');
run('silent limitation',f=>{f.snapshot.limitations.push('CI unavailable')},false,'UNRESOLVED_LIMITATIONS');
run('PR_LEVEL without fake path/line',f=>{
  f.review.findings=[{verification:'PENDING_VERIFICATION',
    evidence:[{kind:'PR_LEVEL',head_sha:f.snapshot.head_sha,evidence_ref:'ev-pr',
      summary:'cross file invariant',source_type:'CROSS_FILE',redaction_state:'NONE'}]}];
  f.ledger['ev-pr']={kind:'PR_LEVEL',delivered:true,head_sha:f.snapshot.head_sha,snapshot_id:f.snapshot.snapshot_id,redaction_state:'NONE'};
},true);
run('invalid PR_LEVEL fabricated file path',f=>{
  f.review.findings=[{verification:'PENDING_VERIFICATION',
    evidence:[{kind:'PR_LEVEL',head_sha:f.snapshot.head_sha,path:'other.ts',
      evidence_ref:'ev-pr',summary:'cross file',source_type:'CROSS_FILE',redaction_state:'NONE'}]}];
  f.ledger['ev-pr']={kind:'PR_LEVEL',delivered:true,head_sha:f.snapshot.head_sha,snapshot_id:f.snapshot.snapshot_id,redaction_state:'NONE'};
},false,'PR_LEVEL_INVALID');
run('FILE_SPAN reversed line interval',f=>{
  f.review.findings=[{verification:'PENDING_VERIFICATION',evidence:[
    {kind:'FILE_SPAN',path:'a.ts',head_sha:f.snapshot.head_sha,
      ref_side:'HEAD',start_line:10,end_line:9,evidence_ref:'ev-span',redaction_state:'NONE'}]}];
  f.ledger['ev-span']={kind:'FILE_SPAN',path:'a.ts',ref_side:'HEAD',total_lines:100,
    delivered:true,head_sha:f.snapshot.head_sha,snapshot_id:f.snapshot.snapshot_id,redaction_state:'NONE'};
},false,'FILE_SPAN_INVALID');
run('DIFF_LINE falsely reanchors deleted line as RIGHT',f=>{
  f.snapshot.files[0].previous_path='old-a.ts';
  f.review.findings=[{verification:'PENDING_VERIFICATION',evidence:[
    {kind:'DIFF_LINE',path:'a.ts',previous_path:'old-a.ts',head_sha:f.snapshot.head_sha,
      side:'RIGHT',line:10,hunk_id:'hunk1',evidence_ref:'ev-diff',redaction_state:'NONE'}]}];
  f.ledger['ev-diff']={kind:'DIFF_LINE',path:'a.ts',old_path:'old-a.ts',side:'LEFT',line:10,hunk_id:'hunk1',
    delivered:true,head_sha:f.snapshot.head_sha,snapshot_id:f.snapshot.snapshot_id,redaction_state:'NONE'};
},false,'DIFF_ANCHOR_INVALID');
run('masked-only finding cannot claim source confirmed',f=>{
  f.review.findings=[{verification:'CONFIRMED_SOURCE',evidence:[
    {kind:'PR_LEVEL',head_sha:f.snapshot.head_sha,evidence_ref:'ev-pr',summary:'secret-bearing data',
      source_type:'CI',redaction_state:'REDACTED'}]}];
  f.ledger['ev-pr']={kind:'PR_LEVEL',delivered:true,head_sha:f.snapshot.head_sha,snapshot_id:f.snapshot.snapshot_id,redaction_state:'REDACTED'};
},false,'MASKED_SOLE_EVIDENCE');
