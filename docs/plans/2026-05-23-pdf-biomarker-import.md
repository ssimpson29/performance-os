# PDF biomarker import via native OpenAI PDF support (2026-05-23)

## Problem

Lab portal exports (Quest, LabCorp, etc.) are PDFs. The current
biomarker image-extraction route only accepts PNG / JPG / WebP, and
the user-facing UI told athletes to "screenshot or export each page
as PNG" — friction that blocked Scott from importing his actual panel.

## Goal

Athletes can upload a lab-report PDF directly at `/longevity/import`.
The same vision LLM that handles images now handles PDFs as a first-
class input type. No server-side PDF processing, no new heavy deps.

## Architecture

OpenAI's chat completions API gained native PDF support via a `file`
content type in late 2024. The model rasterizes pages internally and
runs vision over them, also reading any embedded text layer. Works
for `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`-class, `gpt-5`-class. We don't
need `pdfjs-dist` or a server-side canvas binding.

### Content-type dispatch

`extractPanelFromImage` is renamed to `extractPanelFromLabReport` and
takes the original `filename` plus `mimeType` from the route. The
function branches on `mimeType`:

- `image/jpeg | image/png | image/webp` → existing `image_url`
  content type with a data URL. Unchanged.
- `application/pdf` → new `file` content type:

```json
{
  "type": "file",
  "file": {
    "filename": "panel.pdf",
    "file_data": "data:application/pdf;base64,<...>"
  }
}
```

Same endpoint (`/v1/chat/completions`), same system prompt, same JSON
parsing, same throw-on-real-failure error contract from the last fix.

### Filename plumbing

The route already has the original `file.name` from `formData.get('image')`.
Pass it through to the extractor — OpenAI requires `filename` on the
file content type.

### Older-model fallback

If the configured `AI_COACH_MODEL` doesn't support the file content
type (older `gpt-3.5-turbo`, some self-hosted models), the API returns
a 400 with a message about unsupported content type. The extractor's
already-strengthened error path (HTTP non-2xx throws with the API
message) bubbles that up to the route, which surfaces it as a 502
with the real message — the athlete sees something like
*"Vision LLM returned 400 from gpt-3.5-turbo: 'file' content type
not supported by this model"*, clear enough to action.

No silent fallback to text extraction in this PR. If we hit that case
in practice, we'll add `pdfjs-dist`-based text fallback in a follow-up.

## Route changes (`apps/web/app/api/imports/biomarker-panel-image/route.ts`)

- Re-add `application/pdf` to `SUPPORTED_MIME`.
- Remove the PDF preflight rejection block (the one we just added).
- Pass `file.name` through to the extractor alongside `mimeType` and
  `imageBase64` — for PDFs `imageBase64` is actually the PDF base64,
  but the field name stays for backward compat in this PR.

## UI changes (`apps/web/app/longevity/import/panel-image-uploader.tsx`)

- Re-add `application/pdf` to the `accept` attribute.
- Helper text: "JPG, PNG, WebP, or PDF. Lab portal exports (Quest,
  LabCorp, etc.) work directly — no need to convert."

## Tests

- Replace the "PDF rejected at preflight" test in
  `tests/biomarker-panel-image-route.test.ts` with a happy-path PDF
  test asserting the extractor is called with `mimeType: 'application/pdf'`
  and a non-empty filename.
- Add a test for the older-model error path: extractor rejects with
  a "file content type not supported" message → route returns 502
  with that message intact.
- Tests for the lib layer aren't materially different from the existing
  ones (image vs PDF is a content-type branch, not a control-flow
  branch in the JSON parsing).

## CLAUDE.md

- Rename the "Image-based ingestion (vision LLM)" section to
  "Image / PDF-based ingestion (vision LLM)" and document the dual
  content-type behavior + the model requirement.
- New entry in Open Work or under the recent fixes section.

## Out of scope

- `pdfjs-dist`-based text extraction fallback for models that don't
  support the file content type. Add only if Scott (or a future user)
  hits that case.
- Server-side rasterization via `@napi-rs/canvas`. Same logic — only
  if native PDF support proves insufficient.
- Multi-panel detection (one PDF with multiple panels on different
  pages). The current single-panel-per-upload model is fine for v1.

## Backward compat

Image uploads (the existing path) are unchanged. Anyone with bookmarked
or scripted image uploads continues to work.
