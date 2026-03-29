# Avenas App — Claude Config

Rules are in `.claude/rules/`:
- **avenas-app.md** — project context, stack, and conventions
- **design-fidelity.md** — UI consistency and liquid glass rules
- **technical-defaults.md** — React Native / Expo technical standards
- **workflow.md** — how to plan, build, verify, and iterate

Skills are in `.claude/skills/`:
- **liquid-glass-rn.md** — Apple iOS 26 Liquid Glass for all UI components

---

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- Write a brief spec upfront before touching any code — confirm with user before building
- If something goes sideways mid-task, STOP and re-plan immediately
- Use plan mode for verification steps, not just building

### 2. Self-Improvement Loop
- After ANY correction from the user: note the pattern and avoid repeating it
- Write rules for yourself that prevent the same mistake next time
- Review lessons at the start of each session for relevant context

### 3. Verification Before Done
- Never mark a task complete without proving it works
- Ask yourself: "Would a senior React Native developer approve this?"
- Check for: missing fallbacks, missing safe area insets, missing TypeScript types
- For UI components: confirm liquid glass guard and fallback are both present

### 4. Demand Elegance
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky, implement the proper solution instead
- Skip this for simple obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 5. Autonomous Bug Fixing
- When given a bug: just fix it, don't ask for hand-holding
- Point at the error, trace the cause, resolve it
- Zero context switching required from the user

---

## Task Management

1. **Plan First** — write a short plan with checkable steps before coding
2. **Verify Plan** — check in with user before starting implementation on big tasks
3. **Track Progress** — mentally mark items complete as you go
4. **Explain Changes** — give a high-level summary at each step, not a wall of code comments
5. **Capture Lessons** — after any correction, note what to do differently

---

## Core Principles

- **Simplicity First** — make every change as simple as possible, minimal code impact
- **No Laziness** — find root causes, no temporary fixes, senior developer standards
- **Minimal Impact** — only touch what's necessary, no side effects or new bugs
- **Native First** — always prefer native iOS behaviour over JS re-implementations
- **Liquid Glass Always** — every UI surface gets the glass treatment (see skill file)
