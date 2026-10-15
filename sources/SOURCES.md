# Primary references and evidence basis

Status: research references; verify live platform availability before implementation.

## Official
- OpenAI plugin: https://developers.openai.com/plugins/build/plugins
- OpenAI skills: https://developers.openai.com/plugins/build/skills
- OpenAI plugin quickstart: https://developers.openai.com/plugins/quickstart
- Gemini Web MCP/custom apps: https://support.google.com/gemini/answer/17209137
- Gemini Web Skills: https://support.google.com/gemini/answer/17094296
- Gem-to-Skills migration: https://knowledge.workspace.google.com/admin/generative-ai/gemini-app/about-the-transition-to-skills?hl=ja
- GitHub PR files API: https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files
- GitHub Checks API: https://docs.github.com/en/rest/checks/runs
- MCP Auth: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP Streamable HTTP: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http

## OSS implementation references
- PR-Agent: https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/algo/pr_processing.py
- PR-Agent finding state: https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/algo/review_finding_state.py
- PR-Agent dedup: https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/algo/inline_comment_dedup.py
- Kodus AI review pipeline: https://github.com/kodustech/kodus-ai/blob/main/libs/code-review/pipeline/stages/agent-review.stage.ts
- Kodus validation: https://github.com/kodustech/kodus-ai/blob/main/libs/code-review/pipeline/stages/validate-suggestions.stage.ts
- Kodus CI: https://github.com/kodustech/kodus-ai/blob/main/libs/code-review/pipeline/stages/load-ci-evidence.stage.ts
- Alibaba agent: https://github.com/alibaba/open-code-review/blob/main/internal/agent/agent.go
- Alibaba diff: https://github.com/alibaba/open-code-review/blob/main/internal/diff/parser.go
- Vercel OpenReview: https://github.com/vercel-labs/openreview/blob/main/workflow/index.ts
- Shippie: https://github.com/mattzcarey/shippie/blob/main/src/review/instructions.ts

## Vendor publications (claims not independently validated)
- Cursor Bugbot: https://cursor.com/blog/building-bugbot
- Greptile: https://www.greptile.com/blog/how-to-build-a-code-review-agent
- Greptile TREX: https://www.greptile.com/blog/trex-code-execution
- Greptile model inversion: https://www.greptile.com/blog/model-inversion
- Qodo: https://www.qodo.ai/blog/Introducing-qodo-2.0-agentic-code-review/
- CodeRabbit: https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews

## Caveats
- OSS license/NOTICE check required before source reuse, especially AGPL implementations.
- Gemini Web Skill-to-MCP orchestration remains unverified.
- GitHub API does not guarantee exhaustive code search/CI proof.
