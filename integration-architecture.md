# Arquitectura de Integración — TPDC Freelance Engine

*Fecha: 5 de abril 2026*

---

## Visión General

Tres componentes: un **scraper** que recolecta jobs, un **evaluador** que filtra y scora con IA, y un **dashboard** donde vos ves lo que vale la pena y ejecutás con TPDC. Todo corre en tu máquina o en un server barato.

---

## Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────────────────┐
│                         JOB SCRAPER LAYER                           │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Upwork  │ │  GitHub  │ │ RemoteOK │ │   WWR    │ │  Reddit  │ │
│  │  RSS/API │ │  API     │ │  API     │ │  Scrape  │ │  API     │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │            │            │             │            │        │
│       └────────────┴────────────┴─────────────┴────────────┘        │
│                                 │                                    │
│                        ┌────────▼────────┐                          │
│                        │  Job Normalizer │                          │
│                        │  (estructura    │                          │
│                        │   uniforme)     │                          │
│                        └────────┬────────┘                          │
│                                 │                                    │
└─────────────────────────────────┼────────────────────────────────────┘
                                  │
┌─────────────────────────────────┼────────────────────────────────────┐
│                         EVALUATION LAYER                             │
│                                 │                                    │
│                        ┌────────▼────────┐                          │
│                        │  Stack Filter   │                          │
│                        │  (keyword match)│                          │
│                        └────────┬────────┘                          │
│                                 │ (pasan ~40%)                      │
│                        ┌────────▼────────┐                          │
│                        │  Budget Filter  │                          │
│                        │  (min $50-$100) │                          │
│                        └────────┬────────┘                          │
│                                 │ (pasan ~60% de los que quedan)    │
│                        ┌────────▼────────┐                          │
│                        │  AI Evaluator   │                          │
│                        │  (Claude Haiku) │                          │
│                        │  - feasibility  │                          │
│                        │  - time estimate│                          │
│                        │  - $/hr estimate│                          │
│                        └────────┬────────┘                          │
│                                 │ (pasan score ≥ 7)                 │
│                        ┌────────▼────────┐                          │
│                        │  Scorer &       │                          │
│                        │  Ranker         │                          │
│                        └────────┬────────┘                          │
│                                 │                                    │
└─────────────────────────────────┼────────────────────────────────────┘
                                  │
┌─────────────────────────────────┼────────────────────────────────────┐
│                         PERSONAL DASHBOARD                           │
│                                 │                                    │
│                        ┌────────▼────────┐                          │
│                        │  Job Feed       │                          │
│                        │  (ranked list)  │                          │
│                        │                 │                          │
│                        │  [Apply] [Skip] │                          │
│                        │  [Save] [Block] │                          │
│                        └────────┬────────┘                          │
│                                 │                                    │
│                  ┌──────────────┼──────────────┐                    │
│                  ▼              ▼              ▼                    │
│           ┌───────────┐ ┌───────────┐ ┌───────────┐               │
│           │  Proposal │ │  TPDC     │ │  Earnings │               │
│           │  Generator│ │  Workspace│ │  Tracker  │               │
│           │  (Claude) │ │  (execute)│ │  ($$)     │               │
│           └───────────┘ └───────────┘ └───────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────┼────────────────────────────────────┐
│                         EXECUTION LAYER                              │
│                                 │                                    │
│                        ┌────────▼────────┐                          │
│                        │  TPDC Engine    │                          │
│                        │  (ya existente) │                          │
│                        │                 │                          │
│                        │  solve / fix /  │                          │
│                        │  refactor /     │                          │
│                        │  assess / plan  │                          │
│                        └────────┬────────┘                          │
│                                 │                                    │
│                        ┌────────▼────────┐                          │
│                        │  Git + Patches  │                          │
│                        │  (ya existente) │                          │
│                        └─────────────────┘                          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────┼────────────────────────────────────┐
│                         DATA LAYER                                   │
│                                 │                                    │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│    │  SQLite  │  │  Claude  │  │  TPDC    │  │  Cron    │          │
│    │  (jobs,  │  │  API     │  │  Artifacts│ │  (scrape │          │
│    │  apps,   │  │  (Haiku  │  │  (local) │  │  schedule│          │
│    │  earnings│  │  for eval│  │          │  │  )       │          │
│    │  )       │  │  )       │  │          │  │          │          │
│    └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Componentes a Construir

### 1. Job Scraper (`src/scrapers/`)

Cada fuente tiene su propio scraper que produce un formato uniforme:

```typescript
interface ScrapedJob {
  id: string;                    // hash único
  source: 'upwork' | 'github' | 'remoteok' | 'wwr' | 'reddit' | 'arc';
  title: string;
  description: string;
  skills: string[];              // ["React", "TypeScript", "Node.js"]
  budget: {
    type: 'fixed' | 'hourly' | 'monthly';
    min: number;
    max: number;
    currency: string;
  };
  url: string;                   // link al posting original
  postedAt: Date;
  clientInfo?: {                 // si la plataforma lo da
    name: string;
    rating?: number;
    hireRate?: number;           // % de hires vs posts
    totalSpent?: number;
  };
  applicants?: number;           // cuántos ya aplicaron
  raw: string;                   // texto completo original
}
```

**Scrapers específicos:**

| Scraper | Método | Notas |
|---------|--------|-------|
| **Upwork** | RSS feed + API (si tenés token) | Feed RSS es público: `https://www.upwork.com/ab/feed/jobs/rss?q=react+typescript` |
| **GitHub** | GitHub API (`/search/issues?q=label:bounty`) | Buscar labels: "bounty", "paid", "help-wanted" con $ en el body |
| **RemoteOK** | API pública (`https://remoteok.com/api`) | JSON directo, sin auth |
| **We Work Remotely** | Scrape HTML o RSS | RSS: `https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss` |
| **Reddit** | Reddit API (`/r/forhire/new.json`) | Filtrar posts con [Hiring] |
| **Arc.dev** | Scrape o API | Requiere investigar endpoint |
| **HN Who is Hiring** | Algolia HN API | `http://hn.algolia.com/api/v1/search_by_date?tags=ask_hn&query=who+is+hiring` mensual |

### 2. AI Evaluator (`src/evaluator/`)

Usa Claude Haiku (barato y rápido) para evaluar cada job:

```typescript
interface JobEvaluation {
  feasibilityScore: number;     // 1-10
  estimatedHours: number;       // horas de trabajo real
  effectiveHourlyRate: number;  // budget / estimatedHours
  tpdcCommand: 'solve' | 'fix' | 'refactor' | 'assess' | 'plan';
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  stackMatch: number;           // 0-100%
  risks: string[];              // ["vague requirements", "no repo access"]
  recommendation: 'apply' | 'maybe' | 'skip';
  reason: string;               // "Good fit: clear scope, $75/hr effective rate"
}
```

**Costo por evaluación:** ~$0.001-$0.003 con Haiku (1K-2K tokens input, 500 tokens output). Evaluar 100 jobs/día = ~$0.30/día.

### 3. Proposal Generator (`src/proposals/`)

Cuando marcás "Apply", genera proposal con Claude Sonnet:

```typescript
interface ProposalRequest {
  job: ScrapedJob;
  evaluation: JobEvaluation;
  profile: FreelancerProfile;    // tu info, stack, portfolio
  tpdcPlan?: TPDCPlanOutput;     // opcional: correr tpdc plan primero
}

interface ProposalOutput {
  text: string;                   // el proposal listo para pegar
  questions: string[];            // preguntas inteligentes al cliente
  estimatedDelivery: string;      // "24 hours", "2-3 days"
  suggestedPrice: number;         // si es bidding
}
```

### 4. Dashboard (`src/dashboard/`)

**Tecnología:** React + Vite + Tailwind (tu stack). Corre local o en Vercel.

**Views:**
- **Feed**: Lista de jobs rankeados, con score, $/hr, y botones Apply/Skip/Save
- **Applied**: Jobs donde ya aplicaste, status de cada uno
- **Active**: Jobs aceptados, con link a TPDC workspace
- **Earnings**: Tracker de ingresos por mes, por fuente, por tipo de job
- **Settings**: Stack filters, budget mínimos, fuentes habilitadas

**MVP alternativo:** Si no querés construir UI al inicio, el dashboard puede ser un CLI:
```bash
tpdc-jobs feed              # ver jobs del día
tpdc-jobs apply <jobId>     # generar proposal y copiar al clipboard
tpdc-jobs track <jobId>     # marcar como aceptado
tpdc-jobs earnings          # ver ingresos del mes
```

### 5. Earnings Tracker (`src/tracker/`)

Simple tabla en SQLite:

```sql
CREATE TABLE earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT REFERENCES jobs(id),
  source TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',  -- pending, paid, disputed
  started_at DATETIME,
  delivered_at DATETIME,
  paid_at DATETIME,
  hours_worked REAL,
  tpdc_runs INTEGER DEFAULT 0,    -- cuántas ejecuciones de TPDC usaste
  notes TEXT
);
```

---

## Cómo Se Conecta con TPDC Engine (Ya Existente)

### Lo que ya tenés y funciona
- `tpdc solve` → ejecutar feature completa
- `tpdc fix` → arreglar bugs
- `tpdc refactor` → mejorar estructura
- `tpdc assess` → auditar código
- `tpdc plan` → planificar antes de ejecutar
- `tpdc show/diff` → inspeccionar resultados
- Learning loop → mejora con cada run

### Lo que se agrega como wrapper

```typescript
// Nuevo: ejecutar TPDC en contexto de un job freelance
import { TPDCEngine } from 'tpdc-engine';

async function executeJob(job: AcceptedJob) {
  const engine = new TPDCEngine({ adapter: 'api' });

  // 1. Plan primero (gratis, solo análisis)
  const plan = await engine.plan(job.description, {
    repoRoot: job.repoPath,
  });

  // 2. Si el plan se ve bien, ejecutar
  if (plan.readiness === 'ready') {
    const result = await engine.solve(job.description, {
      repoRoot: job.repoPath,
      apply: true,
    });

    // 3. Guardar resultado y actualizar tracker
    await updateEarnings(job.id, { tpdcRuns: 1, status: 'delivered' });
    return result;
  }
}
```

No se modifica TPDC Engine. Se usa como library (ya exporta todo en `src/index.ts`).

---

## Stack Técnico Completo

| Componente | Tecnología | Por qué |
|------------|-----------|---------|
| Scrapers | TypeScript + node-cron | Tu lenguaje, cron para scheduling |
| Evaluator | Claude Haiku (API) | Barato ($0.003/eval), rápido |
| Proposal Gen | Claude Sonnet (API) | Mejor calidad para proposals |
| Execution | TPDC Engine (ya existe) | El motor de producción |
| Database | SQLite (better-sqlite3) | Zero config, corre local, sin servidor |
| Dashboard | React + Vite + Tailwind | Tu stack, puede ser local o Vercel |
| Cron/Scheduler | node-cron (o sistema cron) | Scheduling de scrapes |
| CLI | Commander.js (o el CLI de TPDC extendido) | Acceso rápido sin abrir browser |

### Dependencias nuevas a agregar

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "rss-parser": "^3.13.0",
    "cheerio": "^1.0.0",
    "commander": "^12.0.0"
  }
}
```

Total: 4 dependencias nuevas. Minimalista.

---

## Infraestructura y Costos

### Opción A: Todo Local (Gratis)
- Scraper corre como cron en tu Mac
- SQLite es un archivo local
- Dashboard corre en localhost:5173
- TPDC Engine corre local
- **Costo: $0 + Claude API (~$30-$80/mes)**

### Opción B: Server Barato (Siempre-On)
- Scraper en Render free tier o VPS $5/mes
- Dashboard en Vercel (gratis)
- SQLite/Turso
- **Costo: $0-$5 + Claude API (~$30-$80/mes)**

**Recomendación para MVP:** Opción A. Todo local. Cuando valides que funciona, subís el scraper a un server para que corra 24/7.

---

## Database Schema Completo

```sql
-- Jobs scraped
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  skills TEXT NOT NULL,          -- JSON array
  budget_type TEXT,
  budget_min REAL,
  budget_max REAL,
  url TEXT NOT NULL,
  posted_at DATETIME,
  scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applicants INTEGER,
  client_info TEXT,              -- JSON
  raw_text TEXT
);

-- AI evaluations
CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT REFERENCES jobs(id),
  feasibility_score INTEGER,
  estimated_hours REAL,
  effective_hourly_rate REAL,
  tpdc_command TEXT,
  complexity TEXT,
  stack_match INTEGER,
  risks TEXT,                    -- JSON array
  recommendation TEXT,
  reason TEXT,
  evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tu decisión sobre cada job
CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT REFERENCES jobs(id),
  status TEXT DEFAULT 'new',     -- new, applied, accepted, rejected, completed, paid
  proposal_text TEXT,
  applied_at DATETIME,
  accepted_at DATETIME,
  delivered_at DATETIME,
  paid_at DATETIME,
  final_amount REAL,
  hours_worked REAL,
  tpdc_workflow_ids TEXT,        -- JSON array de TPDC run IDs
  notes TEXT
);

-- Earnings summary
CREATE VIEW monthly_earnings AS
SELECT
  strftime('%Y-%m', paid_at) as month,
  COUNT(*) as jobs_completed,
  SUM(final_amount) as total_earned,
  AVG(final_amount) as avg_per_job,
  SUM(hours_worked) as total_hours,
  SUM(final_amount) / SUM(hours_worked) as effective_hourly_rate
FROM applications
WHERE status = 'paid'
GROUP BY strftime('%Y-%m', paid_at);

-- Stack filters (configurable)
CREATE TABLE stack_filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  category TEXT DEFAULT 'match',  -- match, bonus, skip
  active INTEGER DEFAULT 1
);
```

---

*Spec técnica de la plataforma personal de freelance + TPDC Engine.*
