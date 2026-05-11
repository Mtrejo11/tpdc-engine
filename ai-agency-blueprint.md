# TPDC Freelance Engine — Plataforma Personal de Job Hunting + Ejecución

*Fecha: 5 de abril 2026*
*Para: Mauricio Trejo — Freelancer potenciado por IA*

---

## La Idea en Una Frase

Una plataforma que scrapea automáticamente trabajos freelance de Upwork, GitHub bounties, job boards remotos y más, los filtra por tu stack (React/TS/Node), evalúa cuáles podés ejecutar rápido con TPDC Engine, y te los presenta listos para que apliqués y ejecutés en horas en vez de días.

---

## El Loop Completo

```
SCRAPEAR → FILTRAR → EVALUAR → APLICAR → EJECUTAR → COBRAR
   │          │         │          │          │          │
   │          │         │          │          │          └─ Stripe/Wise/PayPal
   │          │         │          │          └─ TPDC Engine (solve/fix/refactor)
   │          │         │          └─ Proposal generado por IA
   │          │         └─ TPDC assess/plan (¿puedo hacerlo? ¿cuánto tarda?)
   │          └─ Stack match + budget match + complexity match
   └─ Upwork, GitHub, WWR, RemoteOK, Arc, etc.
```

Vos solo intervenís en dos puntos: aprobar a qué aplicar, y review final antes de entregar. Todo lo demás es automatizable.

---

## 1. Fuentes de Trabajo a Scrapear

### Tier 1: Alto Volumen, Ejecución Corta

| Fuente | Tipo de Trabajo | Rango de Pago | Frecuencia de Scrape |
|--------|----------------|---------------|---------------------|
| **Upwork** | Freelance gigs (fix bugs, add features, code review) | $50-$2,000 por proyecto | Cada 30 min |
| **GitHub Issues con Bounties** | Bug fixes, features en repos open source | $50-$500 por issue | Cada hora |
| **Algora/Gitcoin** | Bounties on-chain y off-chain | $100-$5,000 por bounty | Cada hora |
| **Freelancer.com** | Proyectos cortos similares a Upwork | $50-$1,500 | Cada hora |

### Tier 2: Mejor Pago, Más Competencia

| Fuente | Tipo de Trabajo | Rango de Pago | Frecuencia de Scrape |
|--------|----------------|---------------|---------------------|
| **Toptal** | Proyectos quality, pre-screened | $1,000-$10,000+ | Diario |
| **Arc.dev** | Remote dev jobs, contratos | $2,000-$8,000/mes | Diario |
| **We Work Remotely** | Jobs remotos, algunos part-time | $3,000-$10,000/mes | Diario |
| **RemoteOK** | Jobs remotos, filtro por tech | $2,000-$8,000/mes | Diario |
| **Wellfound (AngelList)** | Startup jobs, equity + cash | Variable | Diario |

### Tier 3: Nichos Específicos

| Fuente | Tipo de Trabajo | Rango de Pago |
|--------|----------------|---------------|
| **r/forhire (Reddit)** | Freelance requests directos | $100-$2,000 |
| **Hacker News (Who is Hiring)** | Thread mensual, quality leads | Variable |
| **X/Twitter** | "#hiring", "#freelance", "#reactjs" | Variable |
| **Discord servers** (dev communities) | Gigs informales, referrals | $50-$1,000 |

---

## 2. Filtros Inteligentes

Cada job scraped pasa por un pipeline de filtrado:

### Filtro 1: Stack Match
```
MATCH si el job menciona:
  - React, React Native, Next.js, Vite
  - TypeScript, JavaScript, Node.js, Express, Bun
  - Tailwind, CSS-in-JS
  - MongoDB, PostgreSQL, SQLite
  - REST API, GraphQL
  - Git, GitHub, CI/CD

BONUS si menciona:
  - Solidity, Web3, Blockchain, Smart Contracts
  - Claude API, OpenAI, LLM integration
  - MCP, Claude Code, AI tooling

SKIP si SOLO requiere:
  - Java, C#, PHP, Ruby, Go (sin JS/TS)
  - iOS nativo (Swift), Android nativo (Kotlin)
  - DevOps puro (Kubernetes, Terraform sin código)
```

### Filtro 2: Complexity Match (Ejecutable con TPDC)
```
IDEAL (ejecutar en horas):
  - "Fix bug in..."
  - "Upgrade React from X to Y"
  - "Add feature to existing app"
  - "Code review"
  - "Refactor component/module"
  - "Write tests for..."
  - "Migrate from X to Y"
  - "Security audit"
  - "Performance optimization"

ACEPTABLE (ejecutar en 1-3 días):
  - "Build landing page"
  - "Create REST API endpoint"
  - "Implement authentication"
  - "Add payment integration"

SKIP:
  - "Build entire app from scratch" (>1 semana)
  - "Ongoing maintenance" (compromiso largo)
  - "Team lead / management" (no es ejecución)
  - Budget <$50 (no vale la pena)
```

### Filtro 3: Budget Match
```
APPLY si:
  - Fixed price ≥ $100
  - Hourly rate ≥ $30/hr
  - Monthly ≥ $2,000

MAYBE si:
  - Fixed $50-$100 (solo si es ultra-rápido, <1hr de trabajo real)

SKIP si:
  - Fixed <$50
  - Hourly <$20
  - "Looking for cheapest option"
```

### Filtro 4: AI Feasibility Score
Usar Claude API para evaluar cada job:
```
Prompt: "Given this job posting, rate 1-10 how feasible it is
for a solo developer with TPDC Engine (AI-powered code pipeline)
to complete in <8 hours. Consider: clarity of requirements,
scope, stack match (React/TS/Node), and execution risk."
```
Solo mostrar jobs con score ≥ 7.

---

## 3. El Flujo de Trabajo Diario

### Mañana (~15 min)
1. Abrir dashboard → ver jobs nuevos filtrados desde ayer
2. Marcar 3-5 jobs como "Apply"
3. Para cada uno, TPDC genera proposal personalizado

### Aplicar (~5 min por job)
4. Revisar proposal generado por IA
5. Ajustar si necesario, enviar

### Ejecutar (cuando te acepten)
6. Clonar repo del cliente
7. `tpdc solve/fix/refactor "descripción del job"`
8. Review rápido del output (~10-15 min)
9. Entregar

### Cobrar
10. Milestone completado → pago automático por la plataforma

**Tiempo diario estimado: 1-2 horas para generar $100-$300/día**

---

## 4. Generación Automática de Proposals

Cada job marcado como "Apply" genera un proposal con Claude:

```
Input:
  - Job posting completo (título, descripción, budget, skills)
  - Tu perfil (stack, experiencia, proyectos)
  - TPDC plan output (si aplica — corrés tpdc plan sobre la descripción)

Output:
  - Proposal personalizado (3-4 párrafos)
  - Estimación de tiempo realista
  - Approach técnico breve
  - Pregunta inteligente al cliente (muestra que leíste el posting)
```

Ejemplo de proposal generado:

```
"Hi, I can handle this React 19 upgrade efficiently. I've recently
upgraded multiple production apps from React 18→19, including handling
the new compiler and Suspense changes.

My approach:
1. Audit current codebase for breaking changes (~30 min)
2. Upgrade core deps + fix type errors (~2 hrs)
3. Test critical paths and fix regressions (~1 hr)
4. PR with detailed changelog

I can deliver within 24 hours of starting.
Quick question: are you using any class components,
or is the codebase fully hooks-based?"
```

---

## 5. Scoring y Priorización de Jobs

Cada job recibe un score compuesto:

| Factor | Peso | Cómo se calcula |
|--------|------|-----------------|
| Budget por hora estimada | 30% | (budget / horas estimadas de ejecución) |
| Stack match | 25% | % de skills que matchean tu perfil |
| AI Feasibility | 20% | Score 1-10 de Claude |
| Frescura del post | 15% | Jobs <2 horas tienen prioridad |
| Competencia estimada | 10% | Pocos applicants = mejor score |

Los jobs se ordenan por score. Los top 5-10 del día son los que ves en tu dashboard.

---

## 6. Revenue Model Realista

### Escenario Conservador: $2,500/mes

| Métrica | Valor |
|---------|-------|
| Jobs aplicados por semana | 15-20 |
| Acceptance rate | 15-20% |
| Jobs ejecutados por semana | 3-4 |
| Precio promedio por job | $150-$200 |
| Revenue semanal | ~$600 |
| **Revenue mensual** | **~$2,500** |
| Horas trabajadas por semana | ~10-12 |

### Escenario Optimista: $5,000/mes

| Métrica | Valor |
|---------|-------|
| Jobs aplicados por semana | 25-30 |
| Acceptance rate | 20-25% |
| Jobs ejecutados por semana | 5-7 |
| Precio promedio por job | $200-$300 |
| Revenue semanal | ~$1,200 |
| **Revenue mensual** | **~$5,000** |
| Horas trabajadas por semana | ~15-20 |

### Costos

| Item | Mensual |
|------|---------|
| Claude API (scraping eval + proposals + TPDC runs) | $30-$80 |
| Hosting (scraper + dashboard) | $0-$7 |
| Upwork/plataformas (fees del 10-20%) | Incluido en pricing |
| **Total costos** | **~$30-$90/mes** |

**Margen neto: 95%+**

---

## 7. Ventaja Competitiva vs Otros Freelancers

| Lo que hacen otros | Lo que hacés vos con TPDC |
|-------------------|--------------------------|
| Leen el posting, piensan 30 min, escriben proposal | TPDC genera proposal informado en 30 seg |
| Estiman "me toma 2 días" | TPDC plan te dice exactamente qué hay que hacer |
| Ejecutan manualmente, bugs, trial-and-error | TPDC pipeline: intake→design→decompose→execute→validate |
| Entregan sin quality gate | TPDC validate da score 0-100 antes de entregar |
| Aprenden de sus errores mentalmente | TPDC learning loop acumula lecciones automáticamente |
| Manejan 2-3 proyectos a la vez | Vos podés manejar 5-7 porque cada uno toma la mitad del tiempo |

Tu velocidad de ejecución es tu moat. Donde otro freelancer tarda 8 horas, vos tardás 2-3 (1 hora de TPDC + 1-2 horas de review/ajustes). Eso te permite cobrar lo mismo pero trabajar menos, o cobrar menos y ganar más proyectos.

---

## 8. Escalamiento Futuro

### Fase 1 (Ahora): Solo vos ejecutando
- Scraper + dashboard + TPDC
- Target: $2K-$5K/mes

### Fase 2 (3-6 meses): Reputation farming
- Construir perfil 5-star en Upwork/Toptal
- Subir rates gradualmente ($50/hr → $75/hr → $100/hr)
- Menos jobs pero mejor pagados

### Fase 3 (6-12 meses): Productizar
- Si detectás un tipo de job que se repite mucho (ej: "React upgrades"), crear un servicio productizado
- Landing page: "React 18→19 Migration in 24 hours — $500 flat"
- Eso ya no es freelance, es un micro-SaaS de servicios

### Fase 4 (Opcional): Marketplace propio
- Un directorio de servicios dev automatizados
- Otros devs pueden usar TPDC como motor (ahí sí vendrías a venderlo)
- Pero eso es futuro, primero validar que el modelo funciona para vos

---

*Blueprint estratégico para plataforma personal de freelance potenciado por TPDC Engine.*
