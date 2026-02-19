<p align="center">
  <h1 align="center">Logic Agent</h1>
  <p align="center"><strong>An agent that knows you, earns your trust, and speaks your language.</strong></p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  </p>
  <p align="center">
    <a href="#how-it-works">How It Works</a> · <a href="#agent-character">Agent Character</a> · <a href="#security">Security</a> · <a href="#architecture">Architecture</a> · <a href="#development">Development</a> · <a href="#contributing">Contributing</a>
  </p>
</p>

---

## What is Logic Agent?

Logic Agent is an open-source autonomous agent forked from [OpenClaw](https://github.com/openclaw/openclaw). It has one defining characteristic: **the agent develops a working relationship with its user.**

Most agent frameworks compete on tools and integrations. Logic Agent competes on the quality of the agent itself — how it reasons, how it communicates, how it remembers, how it earns trust, and how it protects your data.

The agent ships with a **hybrid personality system**. A base profile is configurable (tone, verbosity, formality, domain expertise), and the agent adapts within those bounds over time based on interaction signals. It doesn't just remember what you asked — it learns how you think, what level of detail you need, and how to communicate with you effectively.

Every action the agent takes is classified, gated, and auditable through a **four-dimensional security model**: autonomy-based trust escalation, sandbox hardening, prompt injection defense, and strict data isolation. The agent earns autonomy by demonstrating competence — not by default.

Logic Agent ships with a **dual-mode UI** chosen at onboarding. Advanced mode preserves the full OpenClaw interface for power users and developers. Simplified mode translates terminology into plain language and reduces configuration surface. Both modes are fully functional — switch between them at any time.

Local-first. Single-tenant. Model-agnostic. Open source.

---

<a id="how-it-works"></a>

## How It Works

Logic Agent preserves OpenClaw's proven chat-first interaction model — Gateway architecture, WebSocket infrastructure, lane queue serial execution, and Model Resolver with provider failover. The agent communicates through text conversation, augmented by the existing Lit-based Control UI rebranded and extended.

What changes is the depth of the interaction. The agent isn't a stateless tool executor — it maintains a structured understanding of who you are, what you're working on, and how you prefer to communicate.

### Dual-Mode UI

On first launch, the onboarding flow asks: **how do you want to interact?**

| | Advanced Mode | Simplified Mode |
|---|---|---|
| **Audience** | Developers, power users, sysadmins | Non-technical users, first-time agent users |
| **Terminology** | Technical (Gateway, lanes, providers, model resolver) | Plain language (Connection, tasks, services, AI switcher) |
| **Configuration** | Full settings exposed | Essential settings only, curated defaults, guided options |
| **UI surface** | Complete OpenClaw Lit Control UI, rebranded | Same UI with simplified labels, reduced options, contextual help |

The terminology mapping is configuration-driven — a translation layer between internal technical terms and user-facing simplified labels. The mapping is version-controlled, extensible, and the agent can learn which simplified terms resonate with each user over time.

Both modes connect to the same agent, the same tools, the same data. Nothing is disabled in simplified mode — it's a presentation layer, not a capability restriction.

### Onboarding

First launch triggers onboarding with three purposes: **UI mode selection**, **personality calibration**, and **initial context gathering**.

1. **Mode selection** — Advanced or Simplified. Brief explanation of each. Reversible at any time.
2. **Personality calibration** — Preference questions seed the agent's profile: communication style, technical depth, primary domain, initial autonomy level.
3. **Context gathering** — What are you working on? What tools and data sources matter? Seeds the user model.
4. **Security configuration** — Filesystem boundaries and autonomy level, presented appropriately per mode.

Onboarding is brief and conversational. The agent's first post-onboarding response is already personalized.

---

<a id="agent-character"></a>

## Agent Character

### Hybrid Personality

The agent's personality is a living configuration, not a static prompt.

**Base profile** (user-configurable):
- Tone: formal ↔ casual
- Verbosity: concise ↔ detailed
- Technical depth: beginner ↔ expert (or adaptive)
- Domain affinity: what the agent assumes context about
- Communication style: direct, collaborative, or supportive
- Proactivity: minimal ↔ high
- Correction style: gentle, direct, or socratic

**Adaptive layer** (agent-managed, within bounds):
- The agent observes interaction signals: clarification requests, skipped responses, rephrased questions, unmodified acceptance.
- Based on these signals, it proposes internal personality adjustments — bounded deltas from the base profile.
- Adjustments cannot drift outside the configured personality spectrum.
- All adaptations are logged with triggering signals and timestamps, and decay over time if not reinforced.
- The user can inspect what the agent has learned and reset any or all adaptations.

**Meta-cognitive reflection** (periodic):
- The agent periodically evaluates its own communication effectiveness using a fast, cheap model.
- Examines patterns: response acceptance rates, follow-up frequency, user corrections.
- Proposes personality refinements — surfaced as natural language in simplified mode, structured logs in advanced mode.

### Cognitive Depth

Architectural support for reasoning quality beyond "send prompt, get response":

- **Task decomposition** — Complex requests are broken into subtasks. Each subtask is independently reasoned about, classified by the Autonomy Gate, traced, and auditable.
- **Self-reflection** — After multi-step tasks, the agent evaluates its approach: was this efficient? Were there better alternatives? Reflections are captured in the reasoning trace.
- **Decision quality tracking** — Every decision is scored on outcome, efficiency, and user satisfaction. Scores feed back into confidence calibration and personality adaptation.
- **Reasoning transparency** — Inspect why the agent made any decision. Structured JSONL traces in advanced mode; natural language explanations in simplified mode.

### Memory & Context Continuity

Built on OpenClaw's existing memory system (hybrid BM25+vector search, embedding cache, session indexing), enhanced with structured understanding:

- **User model** — A structured representation of preferences, domain knowledge level, working patterns, and communication style. Distilled from interaction history, updated incrementally, inspectable and resettable.
- **Active context injection** — The agent proactively loads relevant context based on conversation trajectory, not just on-demand search.
- **Preference learning** — Tracks implicit signals: which outputs get accepted vs. modified, which response lengths get engagement, which domains need guidance.
- **Session continuity** — The agent remembers the state of ongoing work, pending decisions, and unresolved questions across sessions.

---

<a id="security"></a>

## Security Model

Four dimensions, all architectural — not afterthoughts.

### 1. Autonomy Gate

Every action is classified and gated:

| Classification | Description | Low | Medium | High |
|---|---|---|---|---|
| `read-only` | Queries, lookups, reads | ✅ | ✅ | ✅ |
| `reversible-write` | File edits, config changes | ❌ Approval | ✅ | ✅ |
| `create-infrastructure` | New tools, services, connections | ❌ Approval | ❌ Approval | ✅ |
| `irreversible` | Deletions, payments, external comms | ❌ Approval | ❌ Approval | ❌ Approval |
| `unknown` | Unclassified actions | ❌ Approval | ❌ Approval | ❌ Approval |

- **Confidence scoring**: Agent reports confidence (0–1) per action. Below threshold, approval is forced regardless of autonomy level.
- **Approve & Remember**: Creates persistent auto-approval rules. Trust expands organically through demonstrated competence.
- **Autonomy progression**: The agent proposes level increases based on its track record. The user confirms or declines.

### 2. Sandbox Hardening

- Content Security Policy for rendered UI content
- iframe isolation for agent-originated output
- Resource access controls scoped to configured directories
- Network access requires explicit user-approved rules

### 3. Agent Output Validation

- **Prompt injection detection** — Input scanning for instruction overrides, role-play attacks, context manipulation
- **Output content scanning** — Responses checked for data leakage, credential exposure, instruction echoing, policy violations
- **Tool output sanitization** — Tool execution results validated before presentation or re-injection into agent context

### 4. Data Isolation

- **Filesystem boundaries** — Configurable readable/writable/denied directory lists. Sensitive directories denied by default.
- **Data flow controls** — Policies governing what data categories can be sent to external APIs. Per-provider allowlists.
- **Per-tool access scoping** — Each tool declares its access scope; the agent enforces it at execution time.
- **Sensitive data handling** — Pattern-based detection of credentials, tokens, private keys, PII. Flagged before storage or external transmission.

---

<a id="architecture"></a>

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Dual-Mode UI Layer                                  │
│  Advanced (full Lit UI) │ Simplified (plain language) │
│  Terminology mapping · Mode switching · Settings      │
├──────────────────────────────────────────────────────┤
│  Agent Character System                              │
│  Personality engine · Cognitive depth · Meta-cognition│
├──────────────────────────────────────────────────────┤
│  Security Layer                                      │
│  Autonomy Gate · Sandbox · Output validation · Data  │
│  isolation                                           │
├──────────────────────────────────────────────────────┤
│  Memory & Context Engine                             │
│  User model · Preference learning · Active context   │
│  injection · Session continuity                      │
│  (Built on OpenClaw memorySearch + embeddings)       │
├──────────────────────────────────────────────────────┤
│  Reasoning Tracer                                    │
│  Per-decision traces · Cost tracking · Task          │
│  decomposition · Self-reflection · Queryable JSONL   │
├──────────────────────────────────────────────────────┤
│  OpenClaw Core (preserved)                           │
│  Gateway · WebSocket · Lane queue · Model Resolver   │
│  · Provider failover · Tool system · Skills          │
└──────────────────────────────────────────────────────┘
```

### What's Preserved from OpenClaw

Gateway architecture, WebSocket infrastructure, lane queue serial execution, Model Resolver with provider failover, Lit Control UI (extended as dual-mode), memory system (memorySearch, hybrid BM25+vector, embedding cache), tool system, skills infrastructure, messaging adapters (made optional), configuration architecture.

### What's New

Agent character system (personality, adaptation, meta-cognition), structured user model, dual-mode UI (advanced + simplified), four-dimensional security model, reasoning tracer with self-reflection, onboarding flow, autonomy gate with earned trust progression, cognitive depth architecture (decomposition, reflection, quality tracking).

---

<a id="development"></a>

## Development

Runtime: **Node >= 22** (Bun also supported for TypeScript execution)

```bash
git clone https://github.com/logic-agent/logic-agent.git
cd logic-agent
pnpm install
pnpm build
pnpm logic-agent onboard
```

### Commands

```bash
pnpm logic-agent          # Run CLI
pnpm dev                  # Dev mode
pnpm build                # Build + typecheck
pnpm test                 # Tests (vitest)
pnpm test:coverage        # Tests with V8 coverage
pnpm check                # Lint + format (oxlint + oxfmt)
pnpm tsgo                 # TypeScript checks
pnpm format               # Format check
pnpm format:fix           # Format fix
```

---

## What This Is NOT

- **Not a chatbot.** The agent reasons, remembers, adapts, and acts — with architectural support for cognitive depth.
- **Not a UI generator.** The interface is OpenClaw's proven Lit UI, extended with a dual-mode simplified layer — not dynamically generated components.
- **Not cloud-dependent.** Local-first, single-tenant. Your data stays on your machine.
- **Not locked to one LLM.** Model-agnostic with provider failover.
- **Not one-size-fits-all.** Dual-mode UI and adaptive personality serve both technical and non-technical users.
- **Not trust-by-default.** The agent earns autonomy through demonstrated competence, gated by a four-dimensional security model.

---

<a id="contributing"></a>

## Contributing

Highest-impact areas:

- **Agent personality adaptation** — better signal detection, more natural bounded adaptation
- **Simplified mode terminology** — the translation layer between technical and plain language needs real user testing
- **Security hardening** — prompt injection detection, output validation, filesystem boundary enforcement
- **Memory system** — user model extraction, preference distillation, active context injection
- **Reasoning quality** — task decomposition, self-reflection hooks, decision quality metrics
- **Onboarding UX** — mode selection flow, personality calibration

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

---

## Built on OpenClaw

Logic Agent is derived from [OpenClaw](https://github.com/openclaw/openclaw), originally created
by **Peter Steinberger** and the OpenClaw community. We gratefully acknowledge their foundational
work.

See [ATTRIBUTION.md](ATTRIBUTION.md) for full credits.

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <em>An agent that knows you, earns your trust, and speaks your language.</em>
</p>
