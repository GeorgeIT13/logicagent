# Attribution

Logic Agent is derived from [OpenClaw](https://github.com/openclaw/openclaw), an open-source
personal AI assistant originally created by **Peter Steinberger** and released under the MIT License.

We gratefully acknowledge Peter's foundational work and the contributions of the entire OpenClaw
community. The original copyright notice is preserved in the [LICENSE](LICENSE) file as required
by the MIT License terms.

## What we kept

Logic Agent builds on several battle-tested OpenClaw subsystems:

- The agentic loop pattern (perceive, reason, act, observe)
- The Gateway and lane queue serial execution model
- The Model Resolver with provider failover and auth rotation
- Session management and state safety primitives
- The plugin and hook architecture

## Where we diverge

Logic Agent is a cloud-native autonomous agent that constructs its own capabilities at runtime.
Key architectural departures from OpenClaw:

- **Cloud-native execution** instead of local-first filesystem access
- **Self-bootstrapping tools** instead of a pre-built skill catalog
- **Vector-powered reasoning cache** instead of text-based memory
- **Multi-tenant by design** with isolated per-user state
- **Configurable autonomy levels** as a first-class architectural concept

## Original project

- Repository: https://github.com/openclaw/openclaw
- Author: Peter Steinberger
- License: MIT
- Contributors: See the OpenClaw CHANGELOG and GitHub contributor graph
