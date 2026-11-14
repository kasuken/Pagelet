# Design direction: a personal digital bookshelf

## Brief and first-pass review

The shop belongs to an individual creator. Its main job is to make the work understandable and desirable, then make paid material easy to find again. The owner needs to publish without navigating a large business suite.

Initial concept: a storefront with a big marketing hero and a uniform grid of cards. Review: that would resemble a generic SaaS landing page and spend the first screen promoting the platform instead of the creator's work. Revised concept: a compact creator introduction beside a tangible featured course cover, followed by a varied bookshelf of actual products. The learning screen becomes quiet; the studio becomes task-focused. The memorable element is the course cover system, not decorative interface chrome.

## Tokens

| Token | Value | Role |
| --- | --- | --- |
| Paper | `#FBFCFF` | Main canvas |
| Ink | `#172B4D` | Text and headings |
| Cobalt | `#244ACC` | Primary actions, active navigation |
| Lilac | `#E4DDFA` | Featured course cover |
| Sea glass | `#D7EDE7` | Download cover and completion background |
| Rule | `#CCD5E4` | Input and structural borders |

Use white surfaces and muted ink `#52647E` as utility values. Never use cover tints as low-contrast text. Cobalt on white is the primary accessible action pair; validate all custom owner accent colors against their actual backgrounds.

Production type: **Manrope** for headings and UI, **Source Sans 3** for long lesson text, self-hosted with their licenses. The zero-dependency prototype uses local Trebuchet MS and system sans fallbacks. No mandatory font CDN. Scale: 13/15/18/24/32/48/64px, with fluid display sizing, sentence case, 1.5 body line-height, and ≤72ch text measure. Financial values use tabular numerals. Avoid all-caps labels, monospace dashboard data, and decorative colored headline fragments.

Spacing: 4/8/12/16/24/32/48/72px. Controls 10px radius; grouped surfaces 18px; large book covers 6px with a subtle spine. Do not apply one radius/shadow to every element. Buttons have a minimum 44px target. Max page width 1200px; body gutters 20px mobile, 40px desktop.

## Structure

Shop: left-aligned creator and title, featured course cover on the right, short outcomes under the copy, filterable product collection below. Different content types get recognizable covers and metadata, not arbitrary icons.

```text
┌ Pagelet / creator shop          Shop · My learning ┐
│ Creator introduction      ┌ featured course cover ┐│
│ Clear promise            │ course title / medium ││
│ Browse the collection    └───────────────────────┘│
│ All products   Courses   Downloads                │
│ [course cover]        [workbook]        [toolkit]  │
│ title, scope, price   title, format     title     │
└ Creator information                 Help · Terms ┘
```

Product page: cover, outcome, price, specific included content, curriculum or file list, preview, creator, prerequisites, refund terms, and one primary purchase action. Show total currency and any tax treatment before checkout. After purchase, replace Buy with Open course/Download where authorized.

Learning: a restrained two-column workspace, ordered curriculum on the left, player and lesson body on the right. Video maintains 16:9; captions/transcript/resources are always findable. Mobile uses a curriculum disclosure above the player. Completion is explicit; show “Saved” only after persistence. A saved state in the prototype is session-only and labeled as a demo.

Studio: persistent narrow navigation, a page title with one primary action, useful metrics, then rows for products or orders. Product editor separates Details, Curriculum/Files, and Pricing. Preview and Publish are distinct actions. Empty states guide the owner to publish their first product; errors identify the field or failed operation and a recovery action.

## Interaction and quality requirements

- Visible 3px cobalt focus ring with offset; logical tab order and skip link.
- Native buttons/links, labelled controls, semantic headings and landmarks. No icon-only action without a name.
- Filters announce result count; dialog returns focus to its trigger and closes with Escape.
- No hover-only functionality. Drag reorder has Move up/Move down controls.
- Save/loading, upload progress/cancel/retry, delayed payment, expired session/link, empty library, revoked access, missing asset, and failed publication states receive designed copy.
- Use inline validation plus an error summary. Destructive edits explain affected purchases.
- Motion answers actions only: ≤160ms color/opacity transitions. No autoplay video, scroll animation, or ornamental reveal sequences. Honor reduced-motion settings.
- Check 360/768/1440px, 200% zoom, touch, keyboard, and screen-reader reading order. Automated a11y checks supplement manual checks.
- Bundle owner UI separately; artwork is local CSS/SVG or optimized local images with meaningful alternative text when informative.

The [interactive prototype](../design/index.html) demonstrates Shop, My learning, and Studio. It deliberately displays its demo status and does not simulate a real successful payment. All sample sales and products are fictional. Production acceptance criteria live in the design/storefront epic and quality epic.
