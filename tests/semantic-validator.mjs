/** Offline reference semantics ONLY: not a production MCP server or authorization proof. */
export function validateSemantic(snapshot, review, live, ledger) {
  const reasons = [], add = (code) => { if (!reasons.includes(code)) reasons.push(code); };
  if (!snapshot || !review || !live || !ledger) return {valid:false,review_status:"FAILED",reason_codes:["MISSING_VALIDATION_INPUT"]};
  if (snapshot.schema_version !== "0.2.0" || review.schema_version !== "0.2.0" || review.review_policy !== "review-policy-v0.2") add("VERSION_MISMATCH");
  if (snapshot.snapshot_id !== review.snapshot_id || snapshot.head_sha !== review.head_sha ||
      snapshot.base_sha !== review.base_sha || snapshot.merge_base_sha !== review.merge_base_sha) add("PIN_MISMATCH");
  if (snapshot.state !== "READY") add("SNAPSHOT_NOT_READY");
  const coverage = snapshot.evidence_coverage || {}, files = Array.isArray(snapshot.files) ? snapshot.files : [];
  const paths = files.map(f=>f.path), uniquePaths = new Set(paths);
  if (paths.length !== uniquePaths.size) add("DUPLICATE_MANIFEST_PATH");
  if (coverage.enumerated_changed_files !== files.length || coverage.reported_changed_files !== files.length) add("MANIFEST_COUNT_MISMATCH");
  const included = files.filter(f=>f.scope === "INCLUDED").map(f=>f.path);
  const excluded = files.filter(f=>f.scope === "EXCLUDED_BY_POLICY").length;
  const unavailable = files.filter(f=>f.scope === "UNAVAILABLE").length;
  if (coverage.included !== included.length || coverage.excluded_by_policy !== excluded ||
      coverage.unavailable !== unavailable || included.length+excluded+unavailable!==files.length) add("MANIFEST_PARTITION_MISMATCH");
  if (excluded!==0 || unavailable!==0) add("INCOMPLETE_SELECTION");
  if (coverage.diff_integrity!=="VERIFIED" || coverage.line_anchor_integrity!=="VERIFIED" ||
      !/^[a-f0-9]{64}$/.test(coverage.manifest_digest||"")) add("UNVERIFIED_DIFF_OR_ANCHORS");
  const inspected=Array.isArray(review.reviewed_paths)?review.reviewed_paths:[], attest=Array.isArray(review.review_attestations)?review.review_attestations:[];
  if (new Set(inspected).size!==inspected.length) add("DUPLICATE_REVIEW_PATH");
  if (inspected.length!==included.length || inspected.some(p=>!included.includes(p)) || included.some(p=>!inspected.includes(p))) add("REVIEW_SCOPE_GAP");
  if (attest.length!==inspected.length || new Set(attest.map(x=>x.path)).size!==attest.length ||
      attest.some(a=>!inspected.includes(a.path))) add("ATTESTATION_SET_MISMATCH");
  for (const a of attest) {
    const refs=Array.isArray(a.review_proof_refs)?a.review_proof_refs:[];
    if (!a.analysis_complete || refs.length===0 || !refs.some(ref=>{
      const ev=ledger[ref];return ev && ev.delivered===true && ev.path===a.path &&
        ev.snapshot_id===snapshot.snapshot_id && ev.head_sha===snapshot.head_sha &&
        ev.redaction_state!=="BLOCKED";
    })) add("ATTESTATION_EVIDENCE_INVALID");
  }
  const findings=Array.isArray(review.findings)?review.findings:[];
  for (const finding of findings) {
    const evidence=Array.isArray(finding.evidence)?finding.evidence:[];
    if (!evidence.length) {add("FINDING_WITHOUT_EVIDENCE");continue;}
    let safelySupported=false;
    for (const anchor of evidence) {
      const ev=ledger[anchor.evidence_ref];
      if (!ev || !ev.delivered || ev.snapshot_id!==snapshot.snapshot_id || ev.head_sha!==snapshot.head_sha) {
        add("EVIDENCE_NOT_IN_LEDGER");continue;
      }
      if (anchor.head_sha!==snapshot.head_sha || anchor.redaction_state!==ev.redaction_state) add("EVIDENCE_SHA_OR_REDACTION_MISMATCH");
      if (anchor.redaction_state==="BLOCKED") add("BLOCKED_EVIDENCE");
      if (anchor.kind==="DIFF_LINE") {
        const file=files.find(f=>f.path===anchor.path);
        if (!file || !Number.isInteger(anchor.line) || anchor.line<1 || !["LEFT","RIGHT"].includes(anchor.side) ||
            ev.kind!=="DIFF_LINE" || ev.line!==anchor.line || ev.hunk_id!==anchor.hunk_id ||
            ev.side!==anchor.side || ev.path!==anchor.path ||
            (anchor.side==="LEFT" && (!file.previous_path || file.previous_path!==anchor.previous_path ||
             ev.old_path!==anchor.previous_path))) add("DIFF_ANCHOR_INVALID");
      } else if (anchor.kind==="FILE_SPAN") {
        if (!Number.isInteger(anchor.start_line) || !Number.isInteger(anchor.end_line) ||
            anchor.start_line<1 || anchor.end_line<anchor.start_line || ev.kind!=="FILE_SPAN" ||
            ev.path!==anchor.path || ev.ref_side!==anchor.ref_side || anchor.end_line>ev.total_lines) add("FILE_SPAN_INVALID");
      } else if (anchor.kind==="PR_LEVEL") {
        if (typeof anchor.path!=="undefined" || typeof anchor.line!=="undefined" ||
            ev.kind!=="PR_LEVEL" || !anchor.summary) add("PR_LEVEL_INVALID");
      } else add("UNKNOWN_EVIDENCE_KIND");
      if (ev.redaction_state==="NONE") safelySupported=true;
    }
    if (finding.verification==="CONFIRMED_SOURCE" && !safelySupported) add("MASKED_SOLE_EVIDENCE");
  }
  if ((review.limitations||[]).length || (snapshot.limitations||[]).length) add("UNRESOLVED_LIMITATIONS");
  if (review.evidence_ledger_digest!==live.evidence_ledger_digest) add("LEDGER_DIGEST_MISMATCH");
  const stale=live.head_sha!==snapshot.head_sha || live.base_sha!==snapshot.base_sha ||
    live.merge_base_sha!==snapshot.merge_base_sha || live.repository_id!==snapshot.repository_id;
  if (stale) add("STALE_BASELINE");
  const status=stale?"STALE":reasons.length?"PARTIAL":review.review_status==="COMPLETE"?"COMPLETE":"PARTIAL";
  return {valid:reasons.length===0,review_status:status,reason_codes:reasons,verified_reviewed_files:attest.filter(a=>a.analysis_complete).length,verified_eligible_files:included.length};
}
