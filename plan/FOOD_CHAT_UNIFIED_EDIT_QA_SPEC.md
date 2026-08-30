# Specification: Unified Active-Meal Edit & Q&A Architecture

## 1. Core Principles

1. **Single-Meal Session Context**:
   - A food chat session belongs exclusively to one active meal.
   - Text-only follow-ups in an existing chat never trigger a new meal scan, never call Vision Scout, and never create a detached second meal card.
   - Creating a separate meal requires opening a new chat/scan.

2. **No Heuristic Keyword Regex Gating**:
   - The backend does NOT use brittle regex filters (`/change|modify|remove|.../`) to decide whether a user's remark is an edit.
   - Any follow-up message when `activeMeal` exists and no new photo is attached routes directly into the integrated single-meal evaluation flow.

3. **Natural Decision Boundary (Edit vs. Q&A)**:
   - **Edit (Food Alteration)**: When the user requests a change to portions, ingredients, substitutions, or modifiers (`unsweetened`, `no oil`, `half portion`, `add egg`), the AI returns structured `modificationCommand` entries. The backend executes the modifications, recalculates all 33 nutrients deterministically, and updates the active meal card.
   - **Q&A / Clinical Discussion**: When the user asks a question or seeks advice (`Why is sodium high?`, `Is this good for blood pressure?`, `What should I eat later?`) without changing food items, the AI returns `modificationCommand: []`. The backend renders the clinical answer in chat while leaving the active meal items and nutrient card 100% intact.
