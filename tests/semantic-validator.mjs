/**
 * Evidiff offline reference semantics, R2.
 * Not a deployed MCP server. This reference intentionally invokes a separate
 * Draft 2020-12 schema validation gate BEFORE any semantic checks. CI installs
 * jsonschema for that gate. A missing gate fails closed.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCHEMA_GUARD = fileURLToPath(new URL('./schema-guard.py', import.meta.url));

function schemaGate(snapshot, review) {
  try {
    const source = JSON.stringify({snapshot, review});
    if (Buffer.byteLength(source, 'utf8') > 2_000_000) return {valid:false,reason_codes:['SCHEMA_INPUT_TOO_LARGE']};
    const p = spawnSync('python3', [SCHEMA_GUARD], {
      input: source, encoding: 'utf8', timeout: 8000, maxBuffer: 32_768,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' }
    });
    if (p.error || p.status !== 0) return {valid:false,reason_codes:['SCHEMA_GATE_UNAVAILABLE']};
    const out = JSON.parse(p.stdout);
    if (typeof out.valid !== 'boolean' || !Array.isArray(out.reason_codes))
      return {valid:false,reason_codes:['SCHEMA_GATE_MALFORMED']};
    return out;
  } catch {
    return {valid:false,reason_codes:['SCHEMA_GATE_UNAVAILABLE']};
  }
}

export function validateSemantic(snapshot, review, live, ledger) {
  const reasons = [];
  const add = (code) => { if (!reasons.includes(code)) reasons.push(code); };
  if (!snapshot || !review) return {valid:false,review_status:'FAILED',reason_codes:['MISSING_VALIDATION_INPUT']};

  // Critical: reject even schema-invalid "COMPLETE" fixtures.
  const preflight = schemaGate(snapshot, review);
  if (!preflight.valid) return {valid:false,review_status:'FAILED',reason_codes:preflight.reason_codes};
  if (!live || !ledger || typeof ledger !== 'object')
    return {valid:false,review_status:'FAILED',reason_codes:['MISSING_TRUSTED_SERVER_INPUT']};

  if (snapshot.snapshot_id !== review.snapshot_id || snapshot.head_sha !== review.head_sha ||
      snapshot.base_sha !== review.base_sha || snapshot.merge_base_sha !== review.merge_base_sha)
    add('PIN_MISMATCH');
  if (snapshot.state !== 'READY') add('SNAPSHOT_NOT_READY');
  const coverage = snapshot.evidence_coverage;
  const files = snapshot.files;
  const paths = files.map(f => f.path);
  if (paths.length !== new Set(paths).size) add('DUPLICATE_MANIFEST_PATH');
  if (coverage.enumerated_changed_files !== files.length ||
      coverage.reported_changed_files !== files.length) add('MANIFEST_COUNT_MISMATCH');
  const included = files.filter(f => f.scope === 'INCLUDED').map(f => f.path);
  const excluded = files.filter(f => f.scope === 'EXCLUDED_BY_POLICY').length;
  const unavailable = files.filter(f => f.scope === 'UNAVAILABLE').length;
  if (coverage.included !== included.length || coverage.excluded_by_policy !== excluded ||
      coverage.unavailable !== unavailable || included.length + excluded + unavailable !== files.length)
    add('MANIFEST_PARTITION_MISMATCH');
  if (excluded || unavailable) add('INCOMPLETE_SELECTION');
  if (files.some(f => f.scope !== 'INCLUDED' && !f.scope_reason))
    add('EXCLUSION_WITHOUT_POLICY_REASON');
  if (coverage.diff_integrity !== 'VERIFIED' || coverage.line_anchor_integrity !== 'VERIFIED' ||
      !/^[a-f0-9]{64}$/.test(coverage.manifest_digest || '')) add('UNVERIFIED_DIFF_OR_ANCHORS');

  const inspected = review.reviewed_paths, attest = review.review_attestations;
  if (new Set(inspected).size !== inspected.length) add('DUPLICATE_REVIEW_PATH');
  if (inspected.length !== included.length || inspected.some(p => !included.includes(p)) ||
      included.some(p => !inspected.includes(p))) add('REVIEW_SCOPE_GAP');
  if (attest.length !== inspected.length || new Set(attest.map(a => a.path)).size !== attest.length ||
      attest.some(a => !inspected.includes(a.path))) add('ATTESTATION_SET_MISMATCH');
  const evidenceValid = (ref, path) => {
    const ev = ledger[ref];
    return !!ev && ev.delivered === true && ev.snapshot_id === snapshot.snapshot_id &&
      ev.head_sha === snapshot.head_sha && ev.path === path &&
      ev.redaction_state !== 'BLOCKED';
  };
  for (const a of attest) {
    if (!a.analysis_complete || !a.review_proof_refs.some(ref => evidenceValid(ref, a.path)))
      add('ATTESTATION_EVIDENCE_INVALID');
  }

  function checkAnchor(anchor) {
    const ev = ledger[anchor.evidence_ref];
    if (!ev || !ev.delivered || ev.snapshot_id !== snapshot.snapshot_id ||
        ev.head_sha !== snapshot.head_sha) {
      add('EVIDENCE_NOT_IN_LEDGER'); return false;
    }
    if (anchor.head_sha !== snapshot.head_sha || anchor.redaction_state !== ev.redaction_state) {
      add('EVIDENCE_SHA_OR_REDACTION_MISMATCH'); return false;
    }
    if (anchor.redaction_state === 'BLOCKED') { add('BLOCKED_EVIDENCE'); return false; }
    if (anchor.kind === 'DIFF_LINE') {
      const file = files.find(f => f.path === anchor.path);
      const oldPath = file && (file.previous_path ?? file.path);
      const expectedCommit = anchor.side === 'LEFT' ? snapshot.merge_base_sha : snapshot.head_sha;
      const deniedSide = (file?.status === 'added' && anchor.side === 'LEFT') ||
                         (file?.status === 'removed' && anchor.side === 'RIGHT');
      const deliveredLine = Number.isInteger(ev.delivered_start_line) &&
        Number.isInteger(ev.delivered_end_line) &&
        ev.delivered_start_line <= anchor.line && anchor.line <= ev.delivered_end_line;
      if (!file || deniedSide || ev.kind !== 'DIFF_LINE' ||
          ev.path !== anchor.path || ev.old_path !== oldPath ||
          anchor.previous_path !== file.previous_path ||
          ev.side !== anchor.side || ev.line !== anchor.line ||
          ev.hunk_id !== anchor.hunk_id || !deliveredLine ||
          ev.commit_sha !== expectedCommit) {
        add('DIFF_ANCHOR_INVALID'); return false;
      }
    } else if (anchor.kind === 'FILE_SPAN') {
      const commit = anchor.ref_side === 'HEAD' ? snapshot.head_sha :
                     anchor.ref_side === 'BASE' ? snapshot.base_sha : snapshot.merge_base_sha;
      const delivered = Number.isInteger(ev.delivered_start_line) &&
        Number.isInteger(ev.delivered_end_line) &&
        ev.delivered_start_line <= anchor.start_line &&
        anchor.end_line <= ev.delivered_end_line;
      if (anchor.end_line < anchor.start_line || ev.kind !== 'FILE_SPAN' ||
          ev.path !== anchor.path || ev.ref_side !== anchor.ref_side ||
          ev.commit_sha !== commit || !delivered ||
          !Number.isInteger(ev.total_lines) || anchor.end_line > ev.total_lines ||
          !/^[a-f0-9]{64}$/.test(ev.exposed_digest || '')) {
        add('FILE_SPAN_INVALID'); return false;
      }
    } else if (anchor.kind === 'PR_LEVEL') {
      if (ev.kind !== 'PR_LEVEL' || ev.source_type !== anchor.source_type ||
          typeof anchor.path !== 'undefined' || typeof anchor.line !== 'undefined' ||
          !anchor.summary) {
        add('PR_LEVEL_INVALID'); return false;
      }
    } else { add('UNKNOWN_EVIDENCE_KIND'); return false; }
    return true;
  }

  for (const finding of review.findings) {
    const evidence = finding.evidence;
    if (!evidence.length) { add('FINDING_WITHOUT_EVIDENCE'); continue; }
    let safe = false;
    for (const anchor of evidence) if (checkAnchor(anchor) && anchor.redaction_state === 'NONE') safe = true;
    for (const anchor of finding.counterevidence || []) checkAnchor(anchor);
    if (finding.verification === 'CONFIRMED_SOURCE' && !safe) add('MASKED_SOLE_EVIDENCE');
    if (finding.verification === 'CONFIRMED_RUNTIME') add('UNSUPPORTED_RUNTIME_ASSERTION');
    if (finding.lifecycle !== 'ACTIVE') add('LIFECYCLE_REQUIRES_REGISTRY');
  }
  if (review.limitations.length || snapshot.limitations.length) add('UNRESOLVED_LIMITATIONS');
  if (review.evidence_ledger_digest !== live.evidence_ledger_digest) add('LEDGER_DIGEST_MISMATCH');
  const stale = live.head_sha !== snapshot.head_sha || live.base_sha !== snapshot.base_sha ||
                live.merge_base_sha !== snapshot.merge_base_sha || live.repository_id !== snapshot.repository_id;
  if (stale) add('STALE_BASELINE');

  const status = stale ? 'STALE' : reasons.length ? 'PARTIAL' :
    review.review_status === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL';
  const valid = reasons.length === 0;
  return { valid, review_status: status, reason_codes: reasons,
    verified_reviewed_files: attest.filter(a=>a.analysis_complete).length,
    verified_eligible_files: included.length };
}
