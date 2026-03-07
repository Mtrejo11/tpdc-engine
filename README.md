# tpdc-engine

Runtime execution engine for TPDC capabilities.

## Setup

npm install
npm run build

## Commands

### Install a capability

node dist/cli.js install-capability <path-to-capability-bundle>

### List installed capabilities

node dist/cli.js list-capabilities

### Run a capability

node dist/cli.js run-capability <capability-id> [input-json-or-file]

## Architecture

- `src/registry/` - Loads installed capability manifests
- `src/runtime/` - Executes capabilities via LLM adapter
- `src/storage/` - Persists artifacts locally
- `src/orchestrator/` - Pipeline coordination (single capability for now)
- `capabilities/installed/` - Installed capability bundles

## LLM Adapter

The engine uses an adapter interface for LLM calls. Default is MockLLMAdapter.
To use a real LLM, implement the LLMAdapter interface and pass it to runCapability().
