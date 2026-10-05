# Domain Docs

How the engineering skills consume this repo's domain documentation.

## Before exploring, read these

- Root `GLOSSARY.md`, when present.
- Product baseline `docs/product-alignment.md`, confirmed UI `docs/ui-alignment.md` / `docs/ui-design.md`, and current decisions `docs/mvp-decisions.md`, when present. `GLOSSARY.md` is a glossary, not an implementation spec.
- Read `docs/README.md` for the current MVP spec, architecture, implementation plan and dependency evidence. Distinguish confirmed decisions from engineering proposals and unverified runtime behavior.
- Relevant decisions in `docs/adr/`, when present.
- `初版需求细化.md` for the original requirements, suggestions, examples and unresolved questions.

If `GLOSSARY.md` or `docs/adr/` do not exist, proceed silently. Do not suggest creating them merely to fill the layout. The `/domain-modeling` skill, reached via `/grill-with-docs` and `/improve-codebase-architecture`, creates them lazily when terms or decisions get resolved.

## File structure

This repo uses **single-context**:

```text
/
├── GLOSSARY.md       # Create only when domain terms are resolved.
├── docs/adr/        # Create ADRs only for actual decisions.
└── src/             # Planned application source; not scaffolded by this setup.
```

No monorepo signals were present at initialization. Do not introduce `CONTEXT-MAP.md` or per-package contexts without evidence that the project needs them.

## Use the glossary's vocabulary

When naming a domain concept in issues, refactor proposals, hypotheses or tests, use the term defined in `GLOSSARY.md`. Avoid synonyms that the glossary explicitly rejects.

If a term is missing, check whether it belongs in the domain; note real vocabulary gaps for `/domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an ADR, identify the ADR and explain why it should be reopened instead of silently overriding it.

## Requirements evidence

The original chat output is not execution evidence. Keep confirmed requirements, proposed architecture, unresolved decisions and verified behavior distinct. Record later user decisions without rewriting the original chat document.
