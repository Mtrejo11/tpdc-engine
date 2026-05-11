# Automation Workflows — TPDC Freelance Engine

*Fecha: 5 de abril 2026*

---

## Resumen

Workflows automatizados para el ciclo completo: scrapear → evaluar → aplicar → ejecutar → cobrar. Todo optimizado para que vos solo intervengas donde tu juicio humano importa.

---

## Workflow 1: Scrape Cycle

**Trigger:** Cron cada 30-60 minutos

```
Cron tick
    │
    ▼
┌─────────────────────────────────────┐
│ 1. Para cada fuente habilitada:     │
│    - Upwork RSS feed                │
│    - RemoteOK API                   │
│    - GitHub Issues API              │
│    - Reddit /r/forhire             │
│    - HN Who is Hiring (mensual)    │
│    - [futuro: más fuentes]          │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 2. Normalizar al schema ScrapedJob  │
│    - Extraer: título, descripción,  │
│      skills, budget, URL, fecha     │
│    - Deduplicar por hash de         │
│      título+descripción             │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 3. Guardar jobs nuevos en SQLite    │
│    - Solo INSERT si no existe       │
│    - Marcar source y scraped_at     │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 4. Log: "{N} nuevos jobs de {source}"│
└─────────────────────────────────────┘
```

**Intervención humana:** Ninguna.
**Costo:** $0 (APIs públicas/RSS).

---

## Workflow 2: Evaluation Pipeline

**Trigger:** Jobs nuevos sin evaluación en DB

```
Después de cada scrape cycle (o cada 15 min)
    │
    ▼
┌─────────────────────────────────────┐
│ 1. SELECT jobs sin evaluación       │
│    WHERE id NOT IN evaluations      │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 2. Stack Filter (local, gratis)     │
│    - Buscar keywords del job en     │
│      stack_filters table            │
│    - Si 0 match keywords → SKIP     │
│    - Si tiene skip keywords → SKIP  │
│    - Guardar stack_match %          │
│                                     │
│    Resultado: ~40% de jobs pasan    │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 3. Budget Filter (local, gratis)    │
│    - Si fixed < $50 → SKIP         │
│    - Si hourly < $20 → SKIP        │
│    - Si no tiene budget → MAYBE     │
│                                     │
│    Resultado: ~60% de los restantes │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 4. AI Evaluation (Claude Haiku)     │
│    Solo para los que pasaron        │
│    stack + budget filters           │
│                                     │
│    Prompt:                          │
│    "Evaluate this freelance job     │
│     for a React/TS/Node developer   │
│     with AI-powered code pipeline.  │
│     Score feasibility 1-10,         │
│     estimate hours, recommend       │
│     apply/maybe/skip."             │
│                                     │
│    Costo: ~$0.003 por eval          │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 5. Score & Rank                     │
│    Fórmula:                         │
│    score = ($/hr_est × 0.30)        │
│          + (stack_match × 0.25)     │
│          + (feasibility × 0.20)     │
│          + (freshness × 0.15)       │
│          + (low_competition × 0.10) │
│                                     │
│    Guardar en evaluations table     │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 6. Notificación (si hay top jobs)   │
│    - Si hay jobs con score ≥ 8:     │
│      notificación al desktop/email  │
│    - "3 nuevos jobs hot: React      │
│       upgrade $500, API fix $200"   │
└─────────────────────────────────────┘
```

**Intervención humana:** Ninguna.
**Costo:** ~$0.30-$1/día en Claude Haiku para 100-300 evaluaciones.

---

## Workflow 3: Daily Review

**Trigger:** Vos, una vez al día (mañana, 15 min)

```
Vos abrís el CLI o dashboard
    │
    ▼
┌─────────────────────────────────────┐
│ $ tpdc-jobs feed                    │
│                                     │
│ Top 10 jobs de hoy:                 │
│                                     │
│ #1 ⭐ Score 9.2 | $75/hr est       │
│    "React 18→19 upgrade for        │
│     e-commerce app"                 │
│    Upwork | Posted 2h ago           │
│    → tpdc-jobs apply job_abc123     │
│                                     │
│ #2 ⭐ Score 8.7 | $60/hr est       │
│    "Fix Stripe webhook handler"     │
│    GitHub Bounty $200               │
│    → tpdc-jobs apply job_def456     │
│                                     │
│ ... (8 más)                         │
└──────────────┬──────────────────────┘
               │
    ▼
Vos decidís: "Apply #1, #2, #5. Skip el resto."
    │
    ▼
Para cada "Apply":
    → Workflow 4 (Proposal Generation)
```

**Intervención humana:** 15 min/día para revisar y decidir.

---

## Workflow 4: Proposal Generation

**Trigger:** `tpdc-jobs apply <jobId>`

```
Comando: tpdc-jobs apply job_abc123
    │
    ▼
┌─────────────────────────────────────┐
│ 1. Cargar job + evaluación del DB   │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 2. (Opcional) Correr TPDC plan      │
│    - tpdc plan "{job.description}"  │
│    - Genera approach técnico real   │
│    - Esto diferencia tu proposal    │
│      de los otros 50 applicants     │
│                                     │
│    Costo: ~$0.01-$0.05 (Sonnet)    │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 3. Generar proposal (Claude Sonnet) │
│                                     │
│    Input:                           │
│    - Job posting completo           │
│    - Tu perfil (hardcoded o config) │
│    - TPDC plan output (si corrió)   │
│    - Template por tipo de job       │
│    - Tone: profesional, conciso,    │
│      técnico pero no arrogante      │
│                                     │
│    Output:                          │
│    - Proposal text (3-4 párrafos)   │
│    - Suggested bid/rate             │
│    - Delivery estimate              │
│    - 1 pregunta inteligente         │
│                                     │
│    Costo: ~$0.02-$0.05             │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 4. Preview + Ajuste                 │
│    - Mostrar proposal en terminal   │
│    - Vos: "ok" (copiar al          │
│      clipboard) o "edit" (ajustar) │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 5. Copiar al clipboard + abrir URL │
│    - pbcopy con el proposal         │
│    - open {job.url} (abre browser) │
│    - Vos pegás el proposal          │
│                                     │
│    Actualizar DB:                   │
│    - status = 'applied'             │
│    - applied_at = now()             │
└─────────────────────────────────────┘
```

**Intervención humana:** ~3 min por proposal (review + pegar).
**Costo:** ~$0.03-$0.10 por proposal.

---

## Workflow 5: Job Execution con TPDC

**Trigger:** Cliente acepta tu proposal. Vos marcás `tpdc-jobs accept <jobId>`

```
Job aceptado
    │
    ▼
┌─────────────────────────────────────┐
│ 1. Setup workspace                  │
│    - Clonar repo del cliente        │
│    - git clone {repo_url}           │
│    - O recibir acceso (invite)      │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 2. TPDC Plan (si no se corrió)      │
│    $ tpdc plan "{job description}"  │
│      --repo-root ~/jobs/{jobId}     │
│                                     │
│    → Review del plan (~5 min)       │
│    → Ajustar si necesario           │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 3. TPDC Execute                     │
│    Según tipo de job:               │
│                                     │
│    Bug fix:                         │
│    $ tpdc fix "{bug description}"   │
│      --apply --repo-root ~/jobs/... │
│                                     │
│    Feature:                         │
│    $ tpdc solve "{feature desc}"    │
│      --apply --repo-root ~/jobs/... │
│                                     │
│    Refactor/Upgrade:                │
│    $ tpdc refactor "{refactor desc}"│
│      --apply --repo-root ~/jobs/... │
│                                     │
│    Code review:                     │
│    $ tpdc assess "{audit scope}"    │
│      --repo-root ~/jobs/...         │
│                                     │
│    → TPDC genera patches            │
│    → Dry-run + safety checks        │
│    → Preview                        │
│    → Confirmás                      │
│    → Aplica patches                 │
│    → Valida (score 0-100)           │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 4. Review humano (~15-30 min)       │
│    - Revisar cambios aplicados      │
│    - Correr tests si el repo tiene  │
│    - Ajustar manualmente si falta   │
│      algo                           │
│    - Commit final                   │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 5. Entregar                         │
│    - Push branch + crear PR         │
│    - O entregar según la plataforma │
│      (Upwork: submit milestone)     │
│    - Mensaje al cliente explicando  │
│      los cambios                    │
│                                     │
│    $ tpdc-jobs deliver {jobId}      │
│    → status = 'delivered'           │
│    → delivered_at = now()           │
└─────────────────────────────────────┘
```

**Intervención humana:** ~30-60 min total (plan review + code review + ajustes).
**Costo:** ~$0.10-$1.00 en Claude API (depende de complejidad).

---

## Workflow 6: Payment Tracking

**Trigger:** Recibís pago en la plataforma

```
Pago recibido (manual check o notificación)
    │
    ▼
┌─────────────────────────────────────┐
│ $ tpdc-jobs paid {jobId}            │
│   --amount 350                      │
│   --hours 3.5                       │
│                                     │
│ → status = 'paid'                   │
│ → paid_at = now()                   │
│ → final_amount = 350               │
│ → hours_worked = 3.5               │
│ → effective_rate = $100/hr          │
│                                     │
│ "✓ Job paid: $350 for 3.5h          │
│   Effective rate: $100/hr           │
│   Monthly total: $1,850"            │
└─────────────────────────────────────┘
```

**Intervención humana:** 30 segundos por job.

---

## Workflow 7: Weekly Analytics

**Trigger:** Domingo por la noche (cron)

```
Cron: domingo 20:00
    │
    ▼
┌─────────────────────────────────────┐
│ Generar resumen semanal:            │
│                                     │
│ 📊 Semana 12 — Resumen              │
│                                     │
│ Jobs scraped:     342               │
│ Evaluados (IA):   89                │
│ Aplicados:        12                │
│ Aceptados:        3                 │
│ Completados:      3                 │
│ Revenue:          $750              │
│                                     │
│ Effective rate:   $62/hr            │
│ Avg time/job:     2.4 hrs           │
│ Best source:      Upwork (2 jobs)   │
│ Best type:        Bug fixes ($85/hr)│
│                                     │
│ Conversión:                         │
│ Scraped→Eval: 26%                   │
│ Eval→Apply: 13%                     │
│ Apply→Accept: 25%                   │
│ Accept→Paid: 100%                   │
│                                     │
│ Acumulado mes: $2,100               │
│ Target: $3,000 (70% ✓)             │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ Guardar en DB + mostrar en          │
│ próximo `tpdc-jobs earnings`        │
└─────────────────────────────────────┘
```

**Intervención humana:** 2 min para leerlo.

---

## Workflow 8: Learning Feedback

**Trigger:** Después de cada job completado (automático)

```
Job completado
    │
    ▼
┌─────────────────────────────────────┐
│ 1. TPDC learning loop (ya existe)   │
│    - Extraer patterns del run       │
│    - Guardar en memory/lessons.json │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 2. Feedback al evaluator            │
│    - ¿La estimación de horas fue    │
│      correcta?                      │
│    - ¿El feasibility score fue      │
│      acertado?                      │
│    - Guardar: actual vs estimado    │
│                                     │
│    Esto mejora futuras evaluaciones │
│    (few-shot examples en el prompt) │
└──────────────┬──────────────────────┘
               │
    ▼
┌─────────────────────────────────────┐
│ 3. Update evaluator prompt          │
│    Cada 10 jobs completados:        │
│    - Agregar top 5 examples al      │
│      prompt del evaluator           │
│    - "Job X: estimé 4h, tardé 2h,  │
│      score 8 → was accurate"        │
│    - Calibración automática         │
└─────────────────────────────────────┘
```

**Intervención humana:** Ninguna.

---

## Workflow 9: Hot Job Alert

**Trigger:** Job nuevo con score ≥ 9 y posted <1 hora

```
Evaluación completa con score ≥ 9
    │
    ▼
┌─────────────────────────────────────┐
│ Notificación inmediata:             │
│                                     │
│ macOS: osascript notification       │
│ "🔥 Hot job: React upgrade $500     │
│  Score 9.3 | Est. 3hrs | $167/hr   │
│  Posted 23 min ago"                 │
│                                     │
│ (Futuro: Slack/Discord/Telegram)    │
└─────────────────────────────────────┘
```

La idea: los mejores jobs se van rápido. Si aplicás en los primeros 30 min, tu tasa de aceptación sube.

**Intervención humana:** Solo si querés aplicar inmediatamente.

---

## Resumen de Automatización

| Workflow | Automatización | Tu Tiempo |
|----------|---------------|-----------|
| Scraping | 100% | 0 min |
| Evaluación + Filtrado | 100% | 0 min |
| Daily Review | 0% (tu decisión) | 15 min/día |
| Proposal Generation | 90% (review final) | 3 min/proposal |
| Job Execution | 70% (TPDC ejecuta, vos revisás) | 30-60 min/job |
| Payment Tracking | Manual (30 seg) | 30 seg/job |
| Weekly Analytics | 100% | 2 min lectura |
| Learning Feedback | 100% | 0 min |
| Hot Alerts | 100% | 0 min |

**Tiempo total diario estimado con 1-2 jobs activos: 1-2 horas.**
**Revenue objetivo con ese tiempo: $100-$300/día → $2,000-$5,000/mes.**

---

## Implementación por Prioridad

### MVP (Semana 1): Solo estos workflows
1. Scrape Cycle (2 fuentes)
2. Evaluation Pipeline
3. Daily Review (CLI)
4. Proposal Generation

### Semana 2-4: Agregar
5. Job Execution con TPDC
6. Payment Tracking
7. Hot Job Alert

### Mes 2+: Agregar
8. Weekly Analytics
9. Learning Feedback
10. Dashboard web

---

*Workflows automatizados para la plataforma personal de freelance.*
