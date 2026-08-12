# Markout Production Readiness Checklist

This checklist is a practical roadmap to move Markout from a strong prototype to a production-ready platform.

## Current baseline

- Compiler/runtime/server architecture is clean and testable.
- Test suite is broad and currently green.
- Key remaining gaps are hardening and completeness, not basic correctness.

## Priority 0: Security and trust boundaries

### 0.1 Clarify and enforce template trust model

- Decide and document whether templates are trusted-only or can be user-supplied.
- If trusted-only, enforce this in docs and deployment guidance.
- If untrusted input is possible, design sandboxing policy before launch.

Acceptance criteria:

- Security model documented in README and server docs.
- CI/docs include a clear "do not run untrusted templates" warning unless sandboxing exists.

### 0.2 Replace or isolate dynamic evaluation in SSR

- Audit all dynamic code evaluation paths (notably server-side props evaluation).
- Implement one of:
  - a safer interpreter for generated expressions, or
  - process isolation/sandboxing with strict input boundaries.
- Add negative tests for code-injection attempts.

Acceptance criteria:

- Threat model doc exists.
- SSR path has explicit mitigation with tests.

### 0.3 Harden path handling and file serving policy

- Keep existing traversal protections and add tests for edge cases (symlink, mixed separators, encoded paths).
- Ensure hidden/internal files and fragment-only files stay non-public.

Acceptance criteria:

- Security-focused path tests added and passing.
- No known path escape in review.

## Priority 1: Compiler completeness and language correctness

### 1.1 Complete stage5 (comptime) or formally defer it

- If comptime is part of language goals, define supported capabilities and implement minimal useful subset.
- If not near-term, mark as deferred and remove ambiguity from docs.

Acceptance criteria:

- Stage has either a shipped scope and tests, or explicit deferment with rationale.

### 1.2 Complete stage6 (treeshake)

- Implement dependency-based elimination for unreachable values/scopes.
- Verify no semantic regressions in reactive updates and SSR output.

Acceptance criteria:

- Treeshake stage has deterministic behavior and regression tests.
- Measurable output/runtime reduction on representative pages.

### 1.3 Close known scope/dependency edge cases

- Audit dependency extraction and navigable-scope resolution for chained scope access patterns.
- Add explicit compile-time diagnostics for unsupported patterns.
- Align compile-time validation with runtime lookup behavior in all naming/shadowing cases.

Acceptance criteria:

- Edge-case matrix documented and tested.
- Unsupported patterns fail with actionable errors.

### 1.4 Tighten parser/DOM fidelity guarantees

- Expand conformance tests for raw-text/atomic-text/foreign-content behavior.
- Ensure serialization and runtime text binding remain aligned for all supported tags.

Acceptance criteria:

- DOM fidelity tests include style/title/template and representative parser corner cases.
- No marker leakage or hydration misalignment in those cases.

## Priority 2: Performance and runtime scalability

### 2.1 Establish benchmark suite and budgets

- Add repeatable micro and scenario benchmarks:
  - compile latency,
  - first render (SSR),
  - hydration time,
  - update throughput for nested scopes and replication.
- Define target budgets for small/medium/large pages.

Acceptance criteria:

- Benchmarks run in CI or nightly.
- Performance regressions are detectable and actionable.

### 2.2 Optimize reactive update paths

- Profile hot paths in scope lookup, dependency linking, and propagation.
- Reduce full-branch refresh frequency when only local topology changes.
- Revisit allocation-heavy clone/update paths under large `:for-each` loads.

Acceptance criteria:

- Profiling report produced.
- At least 2 high-impact optimizations landed with before/after data.

### 2.3 Reduce generated payload/runtime overhead

- Minimize generated props size where safe.
- Eliminate dead metadata in production output.
- Evaluate optional minification/compression integration in server pipeline.

Acceptance criteria:

- Output size trend is tracked.
- Production profile shows measurable payload improvements.

## Priority 3: Developer experience and operability

### 3.1 Improve diagnostics quality

- Standardize compile/runtime error shapes with source locations and remediation hints.
- Add error codes for common parser/compiler failures.
- Improve server error page readability for development mode.

Acceptance criteria:

- Top 10 common failures have clear messages and fix guidance.
- Error snapshots covered by tests.

### 3.2 Add language tooling surface

- Provide syntax highlighting and basic editor support for directives/interpolations.
- Add lint/validation command for templates.
- Consider language server roadmap (hover/docs/diagnostics).

Acceptance criteria:

- Developers can run a one-command template validation pass.
- Basic editor support available and documented.

### 3.3 Deployment and runtime docs

- Document production deployment model (caching, runtime bundle delivery, startup behavior).
- Add observability hooks guidance (logging, metrics, failure alerts).
- Document SSR/hydration lifecycle and troubleshooting playbook.

Acceptance criteria:

- Production deployment guide exists.
- Operations checklist can be followed by a new engineer.

## Cross-cutting quality gates

- CI gates:
  - unit/integration tests,
  - coverage thresholds,
  - typecheck,
  - security checks.
- Compatibility checks:
  - Node versions,
  - platform path behavior,
  - stable server responses.
- Release hygiene:
  - changelog,
  - semantic versioning policy,
  - migration notes for language behavior changes.

Acceptance criteria:

- A release candidate can pass all gates with no manual exception.

## Suggested rollout plan

1. Milestone A (Hardening): complete Priority 0.
2. Milestone B (Language correctness): complete Priority 1.
3. Milestone C (Scale): complete Priority 2.
4. Milestone D (Adoption): complete Priority 3.

Exit target:

- Security model is explicit and tested.
- Compiler stages are complete (or intentionally deferred with clear contract).
- Performance budgets are measurable and met.
- Tooling and docs are sufficient for external adoption.