# Historical: Migrar de extensión propia de subagentes a @tintinweb/pi-subagents

> Superseded by `docs/superpowers/specs/2026-08-07-pi-subagents-and-vision-migration-design.md`. This file records the completed 2026 Tintinweb migration and is not current setup guidance.

## ✅ COMPLETADO

### 1. Eliminar extensiones propias de subagentes
- [x] Borrar directorio `extensions/subagent/` completo
- [x] Borrar `extensions/subagent-models.ts`

### 2. Actualizar `package.json`
- [x] Agregar `@tintinweb/pi-subagents` a `dependencies`
- [x] Actualizar descripción (quitar referencia a subagent models)

### 3. Crear agentes custom en `agents/`
- [x] Crear `agents/worker.md` — prompt_mode: append, all tools, modelo heredado
- [x] Crear `agents/reviewer.md` — read-only, tools: read,bash,grep,find,ls, model: sonnet
- [x] Crear `agents/planner.md` — read-only, tools: read,grep,find,ls
- [x] Crear `agents/scout.md` — read-only, tools: read,grep,find,ls,bash, model: haiku

### 4. Actualizar README
- [x] Documentar dependencia de `@tintinweb/pi-subagents`
- [x] Documentar setup de agentes custom: `cp agents/*.md ~/.pi/agent/agents/`
- [x] Actualizar tabla de extensiones, skills y prompts

### 5. Adaptar `skills/dispatching-parallel-agents/SKILL.md`
- [x] Cambiar API de `subagent()` → `Agent()` + `get_subagent_result()`
- [x] Actualizar agentes disponibles
- [x] Eliminar sección tmux → worktree isolation
- [x] Actualizar concurrencia y streaming

### 6. Adaptar `skills/subagent-driven-development/SKILL.md`
- [x] Cambiar API completa a `Agent()` + `get_subagent_result()`
- [x] Eliminar sección "Model Configuration for Pi"
- [x] Simplificar model selection
- [x] Actualizar workflow completo

### 7-9. Adaptar prompt templates
- [x] `implementer-prompt.md` — quitar bash dispatch, usar Agent()
- [x] `spec-reviewer-prompt.md` — quitar bash dispatch, usar Agent()
- [x] `code-quality-reviewer-prompt.md` — quitar bash dispatch, usar Agent()

### 10-11. Skills menores
- [x] `using-superpowers/SKILL.md` — referencia a @tintinweb/pi-subagents
- [x] `executing-plans/SKILL.md` — referencia a pi con @tintinweb/pi-subagents

### 12. Prompts
- [x] `prompts/implement.md` — de chain a secuencial Agent()
- [x] `prompts/scout-and-plan.md` — de chain a secuencial Agent()
- [x] `prompts/implement-and-review.md` — de chain a secuencial Agent()

### 13. Verificación
- [x] No quedan referencias a `subagent(` API vieja en skills/prompts/extensions
- [x] No quedan referencias a `get_subagent_models` o `/subagent-config` fuera de docs/
- [x] `extensions/` solo contiene `image-label.ts` y `plan-mode/`
- [x] Estructura final correcta
