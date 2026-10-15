import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSemantic } from './semantic-validator.mjs';

const SHA = c => c.repeat(40);
const clone = x => structuredClone(x);

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
  return {snapshot,review,live,ledger};
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
  return anchor;
}
function addPr(f,changes={}) {
  const anchor={kind:'PR_LEVEL',head_sha:f.snapshot.head_sha,evidence_ref:'ev-pr',
    summary:'Cross-file inconsistency',source_type:'CROSS_FILE',redaction_state:'NONE',...changes};
  f.review.findings=[{...defaultFinding(),evidence:[anchor]}];
  f.ledger['ev-pr']={kind:'PR_LEVEL',source_type:'CROSS_FILE',delivered:true,
    snapshot_id:f.snapshot.snapshot_id,head_sha:f.snapshot.head_sha,redaction_state:'NONE'};
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
run('ledger digest mismatch',f=>{f.review.evidence_ledger_digest='f'.repeat(64)},false,'LEDGER_DIGEST_MISMATCH');
run('review attestation ref blocked',f=>{f.ledger['ev-a'].redaction_state='BLOCKED'},false,'ATTESTATION_EVIDENCE_INVALID');
run('snapshot not READY',f=>{f.snapshot.state='PARTIAL'},false,'SNAPSHOT_NOT_READY');
run('undisclosed limitation',f=>{f.snapshot.limitations.push('CI unavailable')},false,'UNRESOLVED_LIMITATIONS');
run('PR_LEVEL correctly omits path and line',f=>{addPr(f)},true);
run('PR_LEVEL path fabricated',f=>{addPr(f,{path:'invented.ts'})},false,'SCHEMA_REVIEW_INVALID');
run('FILE_SPAN within actually delivered span',f=>{addFileSpan(f)},true);
run('FILE_SPAN reverse interval',f=>{addFileSpan(f,{start_line:20,end_line:10})},false,'FILE_SPAN_INVALID');
run('FILE_SPAN outside delivered 1-10, inside file 1-100',f=>{addFileSpan(f,{start_line:50,end_line:60})},false,'FILE_SPAN_INVALID');
run('FILE_SPAN prior commit mismatch',f=>{addFileSpan(f);f.ledger['ev-span'].commit_sha=SHA('e')},false,'FILE_SPAN_INVALID');
run('FILE_SPAN unverified exposed digest',f=>{addFileSpan(f);f.ledger['ev-span'].exposed_digest=null},false,'FILE_SPAN_INVALID');
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
