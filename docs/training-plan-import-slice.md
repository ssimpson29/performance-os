# Training plan import + adaptive coaching slice

This slice adds a first working path for coach-authored training plans with adaptive coaching layered on top.

## What it supports now

- parses the known workbook *sheet structure* after it is converted into sheet-row arrays
- normalizes **Weekly Schedule** into:
  - recurring weekly structure
  - phase/week target tables
- captures **Daily**, **Strength Days**, and **Speed Warmup** as reusable support templates
- adapts Monday and Tuesday when the athlete finishes a stacked, high-strain weekend and recovery is strained
- exposes a JSON scaffold at `POST /api/training-plan/import`

## Current payload contract

The endpoint currently expects JSON like:

```json
{
  "workbook": {
    "sheets": {
      "Weekly Schedule": [["Imported Coach Workbook"], ["Weekly Structure"], ["Day", "Session", "Focus", "Duration", "Notes"]],
      "Daily": [["Workout Type", "Prompt"]],
      "Strength Days": [["Template", "Primary Lift", "Accessory"]],
      "Speed Warmup": [["Step", "Detail"]]
    }
  }
}
```

## Why this shape

The repository did not yet have a stable XLSX parsing dependency/runtime path, so this first slice focuses on the domain logic that matters most:

1. workbook-aware normalization
2. support-template capture
3. baseline adaptive coaching decisions

That keeps the slice testable and lets a later upload layer plug into the same parser without changing downstream plan logic.
