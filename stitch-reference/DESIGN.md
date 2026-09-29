---
name: Task Forge
colors:
  surface: '#0f131c'
  surface-dim: '#0f131c'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#d0bcff'
  on-secondary: '#3c0091'
  secondary-container: '#571bc1'
  on-secondary-container: '#c4abff'
  tertiary: '#4cd7f6'
  on-tertiary: '#003640'
  tertiary-container: '#009eb9'
  on-tertiary-container: '#002f38'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#acedff'
  tertiary-fixed-dim: '#4cd7f6'
  on-tertiary-fixed: '#001f26'
  on-tertiary-fixed-variant: '#004e5c'
  background: '#0f131c'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 2.25rem
    fontWeight: '600'
    lineHeight: 2.75rem
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Inter
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.125rem
  mono-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.375rem
    letterSpacing: -0.01em
  mono-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.25rem
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '400'
    lineHeight: 1rem
  label-md:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.02em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 0.625rem
    fontWeight: '600'
    lineHeight: 0.875rem
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-compact: 0.5rem
  margin: 1.5rem
  margin-mobile: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system targets backend, infrastructure, and distributed systems engineers who demand high-density telemetry, precise execution controls, and zero visual friction. The brand personality is utilitarian, architectural, and razor-sharp—echoing high-reliability operational control planes. It evokes total confidence, surgical precision, and deep technical mastery.

The visual direction fuses **Minimalist Engineering Aesthetics** with **Modern Dark Infrastructure Surfaces**:
- Deep void and charcoal background planes anchored by precise 1px linear partitions.
- Monospaced priority for operational data: timestamps, UUIDs, memory metrics, queue topologies, and payload inspection.
- Functional, luminescent telemetry indicators that guide attention dynamically without ambient noise or decorative clutter.
- Extreme density without claustrophobia, governed by strict micro-alignments, crisp contrast boundaries, and immediate feedback states.

## Colors

The palette is engineered for prolonged low-light monitoring and rapid triage under operational incidents:

- **Canvas & Layering**:
  - `canvas-root`: `#0B0F17` (Deep Obsidian / base background)
  - `surface-base`: `#111827` (Card and panel surface background)
  - `surface-elevated`: `#161F30` (Modals, flyouts, popovers, and table headers)
  - `surface-subtle`: `#1F2937` (Hover states, nested code blocks, and subtle segment controls)
- **Dividers & Strokes**:
  - `border-subtle`: `#1F2937` (Default interior partitions, table cell rules)
  - `border-muted`: `#374151` (Card edges, input bounds, interactive borders)
  - `border-focus`: `#6366F1` (Active selection, focus rings)
- **Brand & Action**:
  - Primary Indigo (`#6366F1`) and Violet (`#8B5CF6`) represent executive actions: queue triggers, batch reruns, and configuration saves.
- **Operational Status Palette (Functional Tokens)**:
  - **Success / Healthy / Acked**: Emerald `#10B981` (background tint: `rgba(16, 185, 129, 0.12)`)
  - **Active / Processing / Worker**: Cyan `#06B6D4` (background tint: `rgba(6, 182, 212, 0.12)`)
  - **Stalled / Retry / Degraded**: Amber `#F59E0B` (background tint: `rgba(245, 158, 11, 0.12)`)
  - **Dead Letter Queue (DLQ) / Failed / Evicted**: Crimson `#EF4444` (background tint: `rgba(239, 68, 68, 0.14)`)
- **Text & Contrast Hierarchy**:
  - `text-primary`: `#F9FAFB` (Headers, active metrics, code values)
  - `text-secondary`: `#9CA3AF` (Descriptions, passive labels, parameter keys)
  - `text-muted`: `#6B7280` (Disabled states, timestamp dates, grid marks)

## Typography

The type system balances human readability for administrative tasks with strict fixed-width alignment for telemetry streams:

- **Inter** governs all UI chrome, navigation items, descriptive documentation, form fields, and modal containers. It utilizes subtle negative tracking on headings to provide a tight, modern dashboard aesthetic.
- **JetBrains Mono** is enforced on all quantitative and technical data:
  - Job IDs, partition hashes, and execution trace spans.
  - JSON and Protobuf payload previews.
  - Latency (p50, p95, p99), throughput rates (req/sec), and memory consumption counters.
  - Status chips and micro-labels.
- All numbers within tables and stream monitors must use tabular numerals (`tnum`) to eliminate layout jitter during high-velocity real-time updates.

## Layout & Spacing

The layout employs a high-density, multi-pane workbench model:

- **Shell Architecture**:
  - Global Collapsible Rail: Fixed at 56px collapsed or 240px expanded.
  - Queue Navigation & Filter Bar: 280px fixed-width secondary pane for quick selection of job pipelines.
  - Telemetry Canvas: Fluid main viewport housing charts, metrics matrices, and execution logs.
  - Inspector Drawer: 440px right-hand slide-over for full JSON stack traces, worker allocations, and payload diffs.
- **Grid & Alignment**:
  - Adopts an 8px structural base with a 4px sub-grid for internal component micro-spacing (compact metrics, badge padding, log line heights).
  - Breakpoints:
    - `desktop-xl` (>= 1440px): 3-pane view simultaneously active (Tree + Table + Inspector).
    - `desktop` (1024px - 1439px): 2-pane view (Navigation + Main Canvas), Inspector opens as a slide-over sheet.
    - `tablet` (768px - 1023px): Collapsible drawer navigation; logs shift to stacked card rows.
    - `mobile` (< 768px): Single pane view with bottom navigation controls and consolidated critical indicators.

## Elevation & Depth

Visual hierarchy does not rely on soft, dramatic drop shadows; it is established via **Tonal Stacking**, **Ghost Outlines**, and **Precise Micro-Gleams**:

- **Stacking Surfaces**:
  - Layer 0 (Canvas Base): `#0B0F17`
  - Layer 1 (Cards, Stream Rows): `#111827` enclosed with a 1px border of `#1F2937`
  - Layer 2 (Floating Popovers, Command Palette, Context Menus): `#161F30` enclosed with a 1px border of `#374151`
- **Micro-Shadows**:
  - `elevation-card`: `0 1px 2px 0 rgba(0, 0, 0, 0.45)`
  - `elevation-overlay`: `0 8px 24px -4px rgba(0, 0, 0, 0.65), 0 2px 6px -1px rgba(0, 0, 0, 0.45)`
- **Luminescence & Glows**:
  - Interactive focal points (e.g., active execution nodes, streaming indicators) utilize subtle inline neon glows: `0 0 12px rgba(99, 102, 241, 0.25)` for primary interactions and `0 0 8px rgba(16, 185, 129, 0.3)` for active health pulses.
  - Top edge 1px micro-highlight (`rgba(255, 255, 255, 0.05)`) on surface cards creates an etched structural depth.

## Shapes

The design system uses a controlled **Soft-Technical (Level 1)** corner geometry:

- **Tokens**:
  - Base radius: `0.25rem` (4px) for controls, status badges, buttons, inputs, and code tags.
  - Large radius (`rounded-lg`): `0.5rem` (8px) for containers, data tables, metrics modules, and modal dialogs.
  - Extra-large radius (`rounded-xl`): `0.75rem` (12px) reserved strictly for command palettes (`Cmd+K`) and full-screen overlay panels.
  - Pills / Circles: Reserved only for live telemetry pulsing indicator dots (e.g., green 6px node status beads).

This sharp, low-radius styling maximizes layout economy and upholds an architectural, console-grade appearance.

## Components

### Buttons & Trigger Controls
- **Primary**: Solid `#6366F1` background, `#FFFFFF` text, 1px border of `rgba(255, 255, 255, 0.12)`. Micro-shadow on idle; on hover: `#4F46E5` with subtle indigo edge aura.
- **Secondary / Ghost**: `#111827` surface, `#374151` border, `#F9FAFB` text. Hover shifts background to `#1F2937` and border to `#4B5563`.
- **Destructive (Purge Queue, Evict Job)**: Background `rgba(239, 68, 68, 0.1)`, border `#EF4444`, text `#EF4444`. Hover: Solid `#EF4444` with `#FFFFFF` text.
- Heights: Dense 28px (`compact`) for table row actions; standard 34px (`default`) for global controls.

### Status Chips & Badges
- Constructed with a 2-part composition: 6px radial dot indicator + uppercase `mono-sm` status label.
- States:
  - *Completed*: Emerald dot + `#10B981` text over `rgba(16, 185, 129, 0.08)` fill and `rgba(16, 185, 129, 0.25)` outline.
  - *Processing*: Cyan dot with subtle ping animation + `#06B6D4` text over `rgba(6, 182, 212, 0.08)` fill.
  - *Retrying*: Amber dot + `#F59E0B` text over `rgba(245, 158, 11, 0.08)` fill.
  - *DLQ / Failed*: Crimson dot + `#EF4444` text over `rgba(239, 68, 68, 0.1)` fill.

### Data Tables & Log Streams
- Monolithic styling: No outer border padding; borders collapse into crisp 1px `#1F2937` gridlines.
- Header row: Sticky `#161F30`, uppercase `label-caps` font, muted `#6B7280` text, 32px height.
- Rows: 36px fixed height for logs; hover triggers immediate row transition to `#161F30`.
- Selection: 2px solid `#6366F1` vertical left bar marker with `#1E1B4B` subtle row highlight.

### Code & Payload Viewers
- Embedded container: Darker `#080B11` inset surface with an explicit 1px `#1F2937` border.
- Syntax highlighting: Cyan for JSON keys, Emerald for strings, Amber for numbers, Indigo for booleans.
- Utility chrome: Floating top-right action tray housing "Copy Raw", "Format", and "Wrap" micro-buttons (24px height).

### Input Fields & Search Bars
- Inset `#0B0F17` fill, 1px `#374151` border, `body-md` typography.
- Focused state: Border changes to `#6366F1` accompanied by a crisp `0 0 0 1px #6366F1` inner ring.
- Integrated keyboard shortcuts: Right-aligned badges (e.g., `⌘K`, `/`) styled with `mono-sm` and `#374151` borders.

### Cards & Telemetry KPI Widgets
- Surface: `#111827`, wrapped in 1px `#1F2937` border.
- Structure: Top metadata row featuring uppercase `label-caps` metric label alongside a time delta tag; middle area featuring 28px bold tabular values; bottom area reserved for micro sparklines or percentile distribution tracks.