# Xterm Auxiliary Extensions Core Auxiliary

## Overview

**Xterm Auxiliary Extensions Core Auxiliary** is the lowest-level extension layer within the Xterm auxiliary extension stack. It provides foundational browser-side services that enhance the core terminal with advanced interaction capabilities such as:

- Accessibility (screen reader support)
- Link detection and activation
- Rendering debouncing and viewport coordination
- Clipboard, paste, and selection utilities
- Decoration and overview ruler rendering

This module centers around the `AccessibilityManager` and closely collaborates with the `Terminal` class and rendering services defined in the parent Xterm modules.

It belongs to the following hierarchy:

- Parent: [Xterm Auxiliary Extensions Core](../xterm-auxiliary-extensions-core/xterm-auxiliary-extensions-core.md)
- Root terminal implementation: [Xterm](../../xterm/xterm.md)

---

## Architectural Context

This module operates inside the browser runtime and extends the core terminal runtime with UI- and accessibility-focused behavior.

```mermaid
flowchart TD
    Terminal["Terminal"] --> AccessibilityManager["AccessibilityManager"]
    Terminal --> Linkifier["Linkifier"]
    Terminal --> RenderService["RenderService"]

    AccessibilityManager --> CoreBrowserService["CoreBrowserService"]
    AccessibilityManager --> RenderService
    AccessibilityManager --> BufferService["BufferService"]

    Linkifier --> MouseService["MouseService"]
    Linkifier --> BufferService
    Linkifier --> LinkProviderService["LinkProviderService"]

    RenderService --> DomRenderer["DomRenderer"]
    DomRenderer --> ThemeService["ThemeService"]
    DomRenderer --> CharacterJoinerService["CharacterJoinerService"]
```

### Key Responsibilities

| Component | Responsibility |
|------------|----------------|
| AccessibilityManager | Builds ARIA tree, manages live region, synchronizes focus and buffer |
| Linkifier | Detects and activates links in terminal buffer |
| RenderService | Coordinates row rendering and viewport refresh |
| BufferDecorationRenderer | Renders decorations anchored to buffer lines |
| Viewport | Manages scroll synchronization and smooth scrolling |
| CompositionHelper | Handles IME composition input |

---

## AccessibilityManager

### Purpose

The `AccessibilityManager` enables screen reader compatibility by:

- Creating an ARIA-compatible representation of terminal rows
- Maintaining a live region for announcing output
- Synchronizing selection and focus events
- Tracking resize and scroll updates

### High-Level Flow

```mermaid
flowchart TD
    TerminalOpen["Terminal.open()"] --> CreateContainer["Create Accessibility Container"]
    CreateContainer --> BuildRows["Build ARIA Row Elements"]
    BuildRows --> AttachListeners["Attach Terminal Event Listeners"]

    AttachListeners --> OnRender["onRender()"]
    AttachListeners --> OnResize["onResize()"]
    AttachListeners --> OnScroll["onScroll()"]

    OnRender --> RenderRows["Render ARIA Rows"]
    RenderRows --> UpdateLiveRegion["Announce Changes"]
```

### Core Mechanisms

#### 1. ARIA Tree Construction

- Creates a container with `role="list"`
- Each row is represented as a `role="listitem"`
- Rows mirror the active buffer viewport

#### 2. Live Region Announcements

- Uses `aria-live="assertive"`
- Batches characters using `TimeBasedDebouncer`
- Limits excessive announcements to prevent screen reader overload

#### 3. Selection Synchronization

On DOM selection changes:

```mermaid
flowchart TD
    SelectionChange["selectionchange"] --> ValidateNodes["Validate Anchor/Focus Nodes"]
    ValidateNodes --> MapToBuffer["Map DOM Position → Buffer Coordinates"]
    MapToBuffer --> TerminalSelect["Terminal.select()"]
```

This ensures that browser-based selection remains consistent with internal buffer selection.

---

## Linkifier Integration

The `Linkifier` scans rendered rows for link providers and decorates ranges with hover and activation behavior.

```mermaid
sequenceDiagram
    participant User
    participant Linkifier
    participant LinkProviderService
    participant Terminal

    User->>Linkifier: mousemove
    Linkifier->>LinkProviderService: provideLinks(row)
    LinkProviderService-->>Linkifier: link ranges
    Linkifier->>Terminal: activate(link)
```

### Capabilities

- Hover underline rendering
- Pointer cursor toggling
- Click activation callbacks
- OSC 8 hyperlink support

---

## Rendering Coordination

### RenderService and Debouncing

Rendering is coordinated through a `RenderDebouncer` to prevent excessive DOM updates.

```mermaid
flowchart LR
    BufferChange["Buffer Change"] --> RenderDebouncer
    RenderDebouncer --> RenderRows["Render Rows"]
    RenderRows --> FireEvents["onRender Event"]
```

This design ensures:

- Frame-aligned updates via `requestAnimationFrame`
- Efficient viewport diffing
- Reduced layout thrashing

---

## Viewport and Scrolling

The `Viewport` component synchronizes scroll position between:

- DOM scroll area
- Terminal buffer
- Render service

```mermaid
flowchart TD
    WheelEvent["Wheel / Scroll"] --> Viewport
    Viewport --> CalculateDelta["Calculate Line Delta"]
    CalculateDelta --> BufferService["Scroll Buffer"]
    BufferService --> RenderService
```

Features include:

- Smooth scroll animation
- Fast scroll modifiers
- Scrollback trimming
- Device pixel ratio awareness

---

## Decorations and Overview Ruler

The module provides visual enhancements via:

- `BufferDecorationRenderer`
- `OverviewRulerRenderer`
- `ColorZoneStore`

These components:

- Attach visual markers to buffer lines
- Track buffer insert/delete operations
- Render mini-map style overview indicators

```mermaid
flowchart TD
    RegisterDecoration["registerDecoration()"] --> DecorationService
    DecorationService --> BufferDecorationRenderer
    BufferDecorationRenderer --> DOMOverlay["DOM Overlay Layer"]

    DecorationService --> OverviewRulerRenderer
    OverviewRulerRenderer --> CanvasRuler["Canvas Overview Ruler"]
```

---

## Input Composition Support

The `CompositionHelper` ensures proper IME (Input Method Editor) handling:

- Tracks composition start/update/end
- Positions composition overlay at cursor location
- Synchronizes text area and rendered cursor

This is critical for multi-byte languages and mobile environments.

---

## Event Model

The module heavily uses an event-driven architecture:

- `EventEmitter`
- Disposable pattern
- Dependency injection via service decorators

```mermaid
flowchart LR
    CoreService --> EventEmitter
    EventEmitter --> AccessibilityManager
    EventEmitter --> RenderService
    EventEmitter --> SelectionService
```

This enables:

- Loose coupling
- Service-level isolation
- Testable and replaceable components

---

## How It Fits into the Overall System

**Xterm Auxiliary Extensions Core Auxiliary** provides the browser-facing interaction layer for the terminal runtime.

It does not implement:

- Escape sequence parsing (handled in core input handler)
- Buffer storage logic
- Protocol handling

Instead, it focuses on:

- Accessibility
- DOM rendering coordination
- User interaction handling
- Decoration and UI overlays

It acts as the bridge between:

- The internal terminal engine
- The browser DOM
- Assistive technologies
- User input devices

---

## Design Characteristics

- Service-based architecture
- Strict separation of buffer vs DOM
- Optimized rendering via debouncing
- Accessibility-first enhancements
- Extensible link and decoration system

This module ensures that the terminal is not only functional but also accessible, performant, and visually extensible within modern browser environments.
