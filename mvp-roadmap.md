# MVP Roadmap — TPDC Freelance Engine

*Fecha: 5 de abril 2026*

---

## Principio

Empezar a ganar plata con el sistema lo más rápido posible. El scraper perfecto no importa si no estás aplicando a jobs. Primero validar el loop manualmente, después automatizar.

---

## Semana 1: Loop Manual Funcional

**Meta: Aplicar a 10 jobs usando TPDC para evaluar y generar proposals.**

### Día 1-2: Scraper v0 (2 fuentes)

| Tarea | Detalle | Tiempo |
|-------|---------|--------|
| Upwork RSS scraper | Parsear `https://www.upwork.com/ab/feed/jobs/rss?q=react+typescript&sort=recency`. Guardar en SQLite. | 2 horas |
| RemoteOK API scraper | Fetch `https://remoteok.com/api`, filtrar por tags. Guardar en SQLite. | 1 hora |
| Job normalizer | Función que convierte ambos formatos al schema `ScrapedJob` uniforme | 1 hora |
| SQLite setup | Crear DB, tablas jobs + evaluations + applications | 30 min |
| Cron local | node-cron que corre ambos scrapers cada hora | 30 min |

### Día 3: Evaluator v0

| Tarea | Detalle | Tiempo |
|-------|---------|--------|
| Stack filter | Keyword matching simple contra la lista de skills | 1 hora |
| Budget filter | Filtrar por mínimo ($50 fixed, $30/hr) | 30 min |
| AI evaluator | Prompt a Claude Haiku: feasibility score, horas estimadas, recomendación | 2 horas |
| Pipeline completo | scrape → normalize → filter → evaluate → guardar en DB | 1 hora |

### Día 4-5: CLI de Jobs

| Tarea | Detalle | Tiempo |
|-------|---------|--------|
| `tpdc-jobs feed` | Mostrar top 10 jobs del día, rankeados por score | 2 horas |
| `tpdc-jobs eval <id>` | Ver evaluación detallada de un job | 1 hora |
| `tpdc-jobs apply <id>` | Generar proposal con Claude Sonnet, copiar al clipboard | 2 horas |
| `tpdc-jobs track <id>` | Marcar job como applied/accepted/delivered/paid | 1 hora |

### Día 6-7: Primeras Aplicaciones Reales

| Tarea | Detalle | Tiempo |
|-------|---------|--------|
| Configurar perfil de Upwork | Si no tenés uno, crearlo optimizado para React/TS/Node | 1-2 horas |
| Aplicar a 10 jobs | Usar `tpdc-jobs apply`, ajustar proposals, enviar | 2-3 horas |
| Calibrar evaluator | Revisar qué jobs filtró mal, ajustar prompts/thresholds | 1 hora |

### Métricas Semana 1
- Scraper corriendo para 2 fuentes
- 50+ jobs evaluados automáticamente
- 10 proposals enviados
- Al menos 1-2 respuestas de clientes

---

## Semana 2-4: Más Fuentes + Primera Ejecución Pagada

### Semana 2: Expandir Scrapers

| Tarea | Detalle | Tiempo |
|-------|---------|--------|
| GitHub bounties scraper | GitHub API: buscar issues con label "bounty"/"paid" + $ en body | 3 horas |
| Reddit r/forhire scraper | Reddit JSON API, filtrar [Hiring] posts | 2 horas |
| HN Who is Hiring scraper | Algolia HN API, thread mensual | 2 horas |
| Deduplicación | Detectar mismos jobs posteados en múltiples fuentes | 1 hora |

### Semana 3: Proposal Quality + TPDC Integration

| Tarea | Detalle | Tiempo |
|-------|---------|--------|
| Proposal templates por tipo | Templates diferentes para: bug fix, feature, upgrade, review | 2 horas |
| TPDC plan integration | Antes de generar proposal, correr `tpdc plan` sobre la descripción del job. Incluir approach técnico real en el proposal. | 3 horas |
| Proposal A/B tracking | Guardar qué proposals convierten y cuáles no. Feedback loop. | 2 horas |
| Earnings tracker CLI | `tpdc-jobs earnings` muestra ingresos del mes, $/hr promedio | 1 hora |

### Semana 4: Primer Job Completado con TPDC

| Tarea | Detalle | Tiempo |
|-------|---------|--------|
| Ejecutar primer job aceptado | Clone repo → `tpdc solve/fix` → review → entregar | Variable |
| Documentar el proceso | Cuánto tardaste, qué funcionó, qué no, lecciones | 30 min |
| Ajustar evaluator | Con data real de ejecución, mejorar estimaciones de horas | 1 hora |
| Segundo round de applications | 15-20 más, con proposals mejorados | 2-3 horas |

### Métricas Semana 2-4
- 4-5 fuentes scrapeando
- 200+ jobs evaluados
- 30+ proposals enviados
- Al menos 1-2 jobs completados y pagados
- Primer $100-$500 ganados

---

## Mes 2-3: Dashboard + Optimización

### Dashboard Web (React)

| Feature | Prioridad | Esfuerzo |
|---------|-----------|----------|
| Job feed con filtros y sorting | Alta | 4-6 horas |
| Job detail con evaluación IA | Alta | 2 horas |
| One-click apply (genera proposal, abre tab de la plataforma) | Alta | 3 horas |
| Earnings dashboard (gráfico mensual, $/hr trend) | Media | 3 horas |
| Application tracker (kanban: applied→accepted→delivered→paid) | Media | 4 horas |
| Settings (filters, budget mínimos, fuentes on/off) | Media | 2 horas |

### Optimización

| Tarea | Detalle |
|-------|---------|
| Mejorar AI evaluator con data real | Usar tus jobs completados como training examples en el prompt |
| Proposal templates personalizados | Crear template por nicho (e-commerce, SaaS, startup) |
| TPDC capabilities custom para freelance | Crear capability "freelance-execute" optimizada para jobs cortos |
| Rate tracking | Monitorear qué rate ($) convierte mejor por tipo de job |
| Time tracking automático | Medir tiempo real de ejecución vs estimado |

### Más Fuentes

| Fuente | Esfuerzo |
|--------|----------|
| Freelancer.com | 3 horas |
| Arc.dev | 2-3 horas |
| Wellfound | 2-3 horas |
| X/Twitter (#hiring) | 3 horas |
| Discord servers (dev communities) | 2-3 horas |

### Métricas Mes 2-3
- Dashboard funcional
- 6-8 fuentes scrapeando
- 10+ jobs completados
- $1,000-$2,500 ganados
- Effective hourly rate identificado ($40-$80/hr con TPDC)

---

## Mes 4-6: Escala y Reputation

### Features

| Feature | Detalle |
|---------|---------|
| Auto-apply mode | Para jobs que matchean score ≥ 9, generar y enviar proposal automático (con tu review en batch al final del día) |
| TPDC learning por tipo de job | Que el learning loop acumule lecciones separadas por: "react-upgrade", "bug-fix", "api-development" |
| Client reputation tracking | Guardar info de clientes que pagan bien/mal, rápido/lento |
| Repeat client detection | Alertar cuando un cliente con quien ya trabajaste postea nuevo job |
| Referral tracking | Si un cliente te refiere a otro, trackear la cadena |

### Growth

| Actividad | Impacto |
|-----------|---------|
| Subir rate en Upwork gradualmente | De $40→$60→$80/hr conforme tu perfil crece |
| Aplicar a Toptal/Arc (plataformas premium) | Jobs mejor pagados, menos competencia |
| Build in public en X | Compartir stats: "Week 12: $3,200 earned, 8 jobs, avg 2.5hrs each" |
| Perfil de GitHub con contribuciones | Los bounties te dan commits en repos populares → credibilidad |

### Métricas Mes 4-6
- $2,000-$5,000/mes consistente
- 15-20 jobs/mes completados
- Effective hourly rate >$50/hr
- 5+ reviews de 5 estrellas en plataformas
- <1.5 horas/día de trabajo promedio (sin contar ejecución TPDC)

---

## Timeline Visual

```
Semana 1         Semana 2-4        Mes 2-3          Mes 4-6
──────────────────────────────────────────────────────────────
│                │                 │                 │
│ 2 scrapers     │ 5 scrapers      │ Dashboard web   │ Auto-apply
│ CLI básico     │ GitHub bounties  │ Earnings viz    │ Premium platforms
│ AI evaluator   │ Reddit/HN        │ Más fuentes     │ Build in public
│ 10 proposals   │ TPDC plan in     │ Custom caps     │ Rate increases
│                │   proposals      │ Time tracking   │
│ $0             │ $100-$500       │ $1K-$2.5K/mes   │ $2K-$5K/mes
│                │                 │                 │
│ Validar loop   │ Primer $$       │ Consistencia    │ Escala
```

---

## Qué NO Hacer

1. **No construir el dashboard antes de tener 5 jobs aplicados manualmente** — El CLI es suficiente
2. **No scrapear 10 fuentes antes de validar con 2** — Upwork + RemoteOK son suficientes para empezar
3. **No optimizar el evaluator sin data real** — Necesitás 10+ jobs completados para saber qué funciona
4. **No automatizar el apply al inicio** — Los primeros 50 proposals los revisás vos, después automatiás
5. **No gastar en infra** — Todo corre local hasta que no ganes $1K/mes
6. **No rechazar jobs "pequeños"** — Un fix de $100 que te toma 30 min con TPDC = $200/hr effective rate

---

## Stack Decisions

| Decisión | Elección | Por qué |
|----------|----------|---------|
| Scrapers | TypeScript + rss-parser + cheerio | Tu stack, herramientas probadas |
| Database | SQLite (better-sqlite3) | Cero config, corre local, un archivo |
| Evaluator | Claude Haiku API | ~$0.003 por evaluación, suficiente calidad |
| Proposals | Claude Sonnet API | Mejor calidad para texto que importa |
| Execution | TPDC Engine (existente) | Ya tenés el motor |
| CLI | Extender CLI de TPDC con subcomando `jobs` | Un solo tool, un solo repo |
| Dashboard (futuro) | React + Vite + Tailwind | Tu stack conocido |
| Hosting (futuro) | Local → Render free tier | Solo cuando necesites 24/7 |

---

*Roadmap para plataforma personal de freelance potenciado por TPDC Engine.*
