# TPDC Engine — Assessment Completo del Proyecto

*Fecha: 5 de abril 2026*
*Autor: Análisis automatizado para Mauricio Trejo*

---

## Resumen Ejecutivo

**TPDC Engine** (Technical Product Development Cycle) es un motor de workflows de desarrollo potenciado por IA que estructura el proceso de desarrollo de software en pipelines predecibles: intake, design, decompose, execute y validate. El proyecto funciona como CLI standalone, paquete npm y como plugin para Claude Code vía MCP (Model Context Protocol).

El proyecto está en un estado sólido de MVP funcional con 69 archivos TypeScript (~11,162 líneas de código fuente), 795+ tests distribuidos en 10+ suites, CI/CD con GitHub Actions, y una arquitectura modular bien diseñada. La calidad del código es alta: tiene validación con Zod, path traversal protection, fuzzy matching para patches, y un sistema de self-learning que acumula lecciones de ejecuciones previas.

Lo más valioso del proyecto no es solo el código — es el modelo mental que implementa. TPDC convierte requests vagos de desarrollo en tickets estructurados, genera Architecture Decision Records, descompone en pasos implementables, ejecuta (con opción de aplicar patches reales), y valida la calidad del resultado. Este ciclo completo es exactamente lo que una agencia de desarrollo cobra miles de dólares por hacer manualmente.

---

## Datos del Proyecto

| Campo | Valor |
|-------|-------|
| **Nombre** | tpdc-engine |
| **Versión** | 0.1.0 |
| **Repositorio** | https://github.com/Mtrejo11/tpdc-engine |
| **Licencia** | MIT |
| **Autor** | mtrejo11 |
| **Lenguaje** | TypeScript |
| **Runtime** | Node.js (ES2022) |
| **Package Manager** | npm |

---

## Stack Técnico Detallado

### Core Dependencies
- **@anthropic-ai/sdk** v0.78.0 — Cliente oficial de Anthropic para llamadas directas a Claude API
- **@modelcontextprotocol/sdk** v1.27.1 — SDK de MCP para exponer tools a Claude Code
- **zod** v4.3.6 — Validación de schemas para inputs/outputs de cada stage

### Dev Dependencies
- **TypeScript** v5.4.0 — Type safety
- **tsx** v4.7.0 — Ejecución directa de TypeScript para tests
- **@types/node** v20 — Tipos de Node.js

### Infraestructura
- **GitHub Actions** — CI en cada push/PR
- **Git** — Integración nativa para aplicar patches
- **File System** — Persistencia de artifacts y memory store

---

## Arquitectura

### Diagrama de Alto Nivel

```
┌─────────────────────────────────────────────────────────────────┐
│                        TPDC ENGINE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐   ┌──────────────┐   ┌───────────────────┐        │
│  │   CLI   │   │  MCP Server  │   │  Library (import)  │       │
│  │ (9 cmds)│   │ (10 tools)   │   │  (programmatic)    │       │
│  └────┬────┘   └──────┬───────┘   └────────┬──────────┘        │
│       │               │                     │                   │
│       └───────────────┼─────────────────────┘                   │
│                       ▼                                         │
│              ┌─────────────────┐                                │
│              │   Dispatcher    │                                │
│              │  (9 commands)   │                                │
│              └────────┬────────┘                                │
│                       ▼                                         │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              PIPELINE ORCHESTRATOR                    │       │
│  │                                                      │       │
│  │  intake → design → decompose → execute → validate    │       │
│  │                                  │                    │       │
│  │                          ┌───────┴───────┐           │       │
│  │                          │  safe mode    │           │       │
│  │                          │  OR           │           │       │
│  │                          │  mutation mode│           │       │
│  │                          └───────────────┘           │       │
│  └──────────────────────────────────────────────────────┘       │
│       │              │               │                          │
│       ▼              ▼               ▼                          │
│  ┌─────────┐  ┌────────────┐  ┌────────────┐                   │
│  │Capability│  │   LLM      │  │  Learning  │                   │
│  │Registry  │  │  Adapters  │  │   Loop     │                   │
│  └─────────┘  └────────────┘  └────────────┘                   │
│                      │                                          │
│         ┌────────────┼────────────┐                             │
│         ▼            ▼            ▼                             │
│    ┌────────┐  ┌──────────┐ ┌──────────┐                       │
│    │Claude  │  │Claude    │ │Agent SDK │                       │
│    │Code CLI│  │API Direct│ │(tool_use)│                       │
│    └────────┘  └──────────┘ └──────────┘                       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                  PATCH SYSTEM                         │       │
│  │  parse → dry-run → safety → preview → confirm → git  │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                ARTIFACT STORAGE                       │       │
│  │  artifacts/<runId>/ → JSON + raw + metadata + summary │       │
│  │  memory/lessons.json → self-learning store             │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Estructura del Código Fuente

```
src/ (69 archivos, ~11,162 LOC)
├── cli.ts                  # CLI entry point (9 comandos)
├── index.ts                # Exports de la librería
├── mcp/                    # MCP stdio server (10 tools)
│   └── server.ts           # ~404 LOC
├── integration/            # Dispatcher + parser + develop orchestrator
│   ├── dispatcher.ts       # Mapea 9 comandos a workflows
│   ├── parser.ts           # Parsea input de CLI/MCP
│   └── developOrchestrator.ts  # Encadena discovery→plan→solve
├── runtime/                # ~1,957 LOC
│   ├── orchestrator.ts     # Pipeline coordinator
│   ├── adapters/
│   │   ├── mockAdapter.ts      # Testing
│   │   ├── claudeCodeAdapter.ts # Claude CLI (Max subscription)
│   │   ├── claudeAdapter.ts     # API directa
│   │   └── agentSdkAdapter.ts   # tool_use structured JSON
│   └── ...
├── plugin/                 # ~4,006 LOC (20 archivos)
│   ├── handlers/           # Normalizers per command
│   └── renderers/          # CLI + markdown output
├── learning/               # ~448 LOC
│   ├── extract.ts          # Extrae lecciones de runs
│   ├── store.ts            # Agrega/deduplica en memory
│   └── inject.ts           # Inyecta lecciones en future runs
├── patch/                  # ~1,620 LOC
│   ├── parseDiff.ts        # Parser de unified diffs
│   ├── dryRun.ts           # Simulación sin modificar
│   ├── safetyChecks.ts     # Deny patterns (.env, credentials)
│   ├── fuzzyMatch.ts       # Relocaliza hunks desplazados
│   ├── gitIntegration.ts   # Branches + commits + apply
│   └── confirmationPreview.ts
├── protocols/              # Schemas Zod para artifacts
├── registry/               # Capability loader
├── storage/                # Persistencia de runs
└── orchestrator/           # Pipeline coordination
```

---

## Features Actuales

### Comandos de Ejecución (Mutation Mode)
1. **solve** — Pipeline completo general
2. **fix** — Bug-fix con normalización de input (extrae plataforma, componente, comportamiento)
3. **refactor** — Mejora estructural (extraction, decomposition, consolidation, simplification, architecture)
4. **develop** — Orquestador multi-paso (feature: discovery→plan→solve, bug: fix, refactor: refactor)

### Comandos de Análisis (Safe Mode)
5. **discovery** — Enmarca ideas vagas, clasifica preguntas como críticas o informativas
6. **assess** — Auditorías de seguridad, performance o arquitectura
7. **plan** — Plan técnico con fases, dependencias y archivos afectados

### Comandos de Inspección
8. **show** — Lista runs recientes o inspecciona uno específico
9. **diff** — Muestra diffs de patches con colores

### Sistema de Capabilities
- 6 capabilities instaladas (intake, design, decompose, execute, execute-patch, validate)
- Cada capability tiene: manifest, prompt, input schema, output schema
- Sistema de versionado y lifecycle (draft → evaluated → promoted → deprecated)
- Instalación de capabilities custom vía `install-capability`

### Self-Learning Loop
- Extrae lecciones de cada run (failure patterns, success patterns, heurísticas)
- Agrega y deduplica en `memory/lessons.json` (max 100 lecciones)
- Inyecta lecciones relevantes en futuros runs (scoring por comando, tags, frecuencia)

### Patch System
- Parser de unified diffs
- Dry-run validation
- Safety checks (deny patterns para archivos sensibles)
- Fuzzy matching para hunks desplazados
- Git integration (branches, commits, rollback)
- Preview + confirmación explícita

### LLM Adapters
- **Claude Code CLI** (default) — Usa tokens del Max subscription
- **Claude API** — Llamadas directas con ANTHROPIC_API_KEY
- **Agent SDK** — Structured JSON vía tool_use
- **Mock** — Testing
- Stage-specific model overrides (`TPDC_STAGE_MODELS`)
- Stage-specific timeouts (`TPDC_STAGE_TIMEOUTS`)

### Plugin de Claude Code
- 9 slash commands disponibles
- MCP server con 10 tools
- Skills con documentación
- Publicable en marketplace de Claude Code

---

## Fortalezas

1. **Arquitectura modular y extensible** — Cada pieza es reemplazable: adapters, capabilities, renderers, handlers
2. **Pipeline bien definido** — El ciclo intake→design→decompose→execute→validate es un modelo mental sólido
3. **Self-learning** — El sistema mejora con uso, acumulando lecciones
4. **Safety-first en mutations** — Dry-run, safety checks, preview, confirmación explícita
5. **Multi-interface** — CLI, MCP, library: tres formas de consumir el mismo motor
6. **Test coverage robusto** — 795+ tests en 10+ suites
7. **CI/CD funcional** — GitHub Actions corre en cada push
8. **Schema validation** — Zod en inputs/outputs previene garbage-in/garbage-out
9. **Capability system versionado** — Permite evolucionar prompts sin romper backward compatibility
10. **Dependencias mínimas** — Solo 3 deps de producción (@anthropic-ai/sdk, @modelcontextprotocol/sdk, zod)

---

## Debilidades

1. **Sin base de datos** — Todo persiste en filesystem (JSON files). No escala para multi-tenant
2. **Sin autenticación** — No hay sistema de auth para clientes/usuarios
3. **Sin API HTTP** — Solo CLI, MCP, y library import. No hay REST/GraphQL endpoint
4. **Sin billing/metering** — No trackea uso ni permite cobrar por ejecución
5. **Sin dashboard/UI** — Solo output de terminal. No hay interfaz visual
6. **Sin rate limiting** — Cualquiera con acceso puede ejecutar infinitos workflows
7. **Dependencia de Anthropic** — Todos los adapters dependen de Claude (no hay fallback a otros LLMs)
8. **Version 0.1.0** — Aún no hay releases estables ni semantic versioning activo
9. **Sin documentación de API programática** — Solo README. No hay docs generados (TypeDoc, etc.)
10. **Sin telemetría** — No hay métricas de uso, latencia, o errores en producción

---

## Oportunidades de Mejora

1. **API HTTP + Auth** — Agregar Express/Hono endpoint con API keys para clientes
2. **Multi-tenant storage** — Migrar de filesystem a DB (SQLite/Postgres) con tenant isolation
3. **Dashboard web** — React frontend para visualizar runs, artifacts, learning
4. **Billing integration** — Stripe/LemonSqueezy para cobrar por workflow
5. **Telemetría** — Métricas de uso, latencia, errores
6. **Capability marketplace** — Que otros devs publiquen capabilities custom
7. **Webhook notifications** — Notificar clientes cuando un workflow termina
8. **Queue system** — Para manejar concurrencia de workflows
9. **Multi-LLM fallback** — Soportar OpenAI, Google, etc. como backup
10. **SDK para clientes** — TypeScript/Python SDK para integrar TPDC en sus sistemas

---

## Estado del Proyecto

| Aspecto | Estado | Notas |
|---------|--------|-------|
| **Funcionalidad core** | Sólido | Pipeline completo funciona |
| **Tests** | Excelente | 795+ tests, CI verde |
| **Documentación** | Buena | README completo, faltan docs de API |
| **Deployment** | MVP | npm + GitHub, sin infraestructura cloud |
| **Producción** | Pre-producción | Funcional pero sin multi-tenant ni billing |
| **Comunidad** | Incipiente | 1 contributor, sin stars visibles |
| **Monetización** | Cero | Sin billing ni modelo de revenue |

**Veredicto: MVP sólido, listo para evolucionar hacia un producto comercial.**

---

*Reporte generado como parte del assessment estratégico para AI Agency.*
