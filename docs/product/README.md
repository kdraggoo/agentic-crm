# Product context layer

The source of truth agents read before evaluating, building or testing a change. The product-owner agent checks every new idea against these files: is it an iteration of an existing feature, does it conflict with anything, does it fit the constraints.

| File | Answers | Primary reader |
|---|---|---|
| [features.md](features.md) | What does the product do today, and where does each feature live in the code? | Product-owner agent |
| [constraints.md](constraints.md) | What must every change respect? | Product-owner, build and test agents |
| [architecture.md](architecture.md) | How is the system put together, and how does data flow? | Build and test agents |

## Project decisions

Decisions about the showcase itself, which constraints cite as "Source: project decision":

- **Generic CRM.** No vertical-specific features unless an approved spec asks for one.
- **Demo mode first.** Idea previews are static demo builds (FakeRest, seeded data, no backend), so every user-facing feature must work in demo mode.
- **No cost.** Only free-tier or no-cost services and dependencies.
- **English only** in committed content.

## Conventions

- **Stable IDs.** Features are `F-<AREA>-<NN>` (e.g. `F-DEAL-03`), constraints are `C-<NNN>`. IDs are never reused or renumbered, so specs, issues and tests can cite them.
- **Evidence over prose.** Every feature and constraint names the files that implement or enforce it. A claim with no file behind it does not belong here.
- **Current state only.** Describe what the code does now, not plans. Ideas live in GitHub Issues until they merge.
- **Terse.** These files are loaded into agent context; every line costs tokens on every run.

## Maintenance

These files are only useful while they match the code. Any change that adds, removes or alters a feature, constraint or architectural element updates the matching file **in the same pull request**. A pull request that changes behavior without touching this folder should say why.
