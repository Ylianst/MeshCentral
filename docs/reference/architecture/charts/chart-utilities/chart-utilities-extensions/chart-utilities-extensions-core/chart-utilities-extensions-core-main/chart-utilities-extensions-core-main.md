# Chart Utilities Extensions Core Main

The **Chart Utilities Extensions Core Main** module encapsulates the primary runtime engine for advanced chart utilities within the MeshCentral UI layer. At its core, it integrates the Chart.js rendering engine (v4.x) and exposes animation, layout, scale, controller, plugin, and rendering orchestration capabilities used by higher-level chart utility extensions.

This module is centered around the `meshcentral.public.scripts.charts.bt` component, which represents the animation scheduler and runtime coordination backbone of the chart system.

---

## 1. Purpose and Responsibilities

Chart Utilities Extensions Core Main is responsible for:

- Coordinating chart animation lifecycles
- Managing per-chart animation queues
- Synchronizing rendering updates with `requestAnimationFrame`
- Dispatching progress and completion events
- Acting as the runtime bridge between datasets, elements, scales, and plugins

It does **not** define chart types or utility helpers directly. Instead, it provides the orchestration layer that higher-level modules depend on.

This module sits within the following hierarchy:

- Parent: Chart Utilities Extensions Core
- Sibling: [Chart Utilities Extensions Core Auxiliary](chart-utilities-extensions-core-auxiliary/chart-utilities-extensions-core-auxiliary.md)

---

## 2. Architectural Positioning

### High-Level Placement in Chart System

```mermaid
flowchart TD
    UI["UI Components"] --> ChartExtensions["Chart Extensions"]
    ChartExtensions --> ChartUtilities["Chart Utilities"]
    ChartUtilities --> ChartUtilitiesExtensions["Chart Utilities Extensions"]
    ChartUtilitiesExtensions --> ChartUtilitiesExtensionsCore["Chart Utilities Extensions Core"]
    ChartUtilitiesExtensionsCore --> ChartUtilitiesExtensionsCoreMain["Chart Utilities Extensions Core Main"]
    ChartUtilitiesExtensionsCore --> ChartUtilitiesExtensionsCoreAux["Chart Utilities Extensions Core Auxiliary"]
```

Chart Utilities Extensions Core Main provides the animation and rendering coordination layer that the rest of the chart system relies upon.

---

## 3. Core Component: bt (Animation Engine)

The `bt` class is the animation scheduler and runtime manager.

### Responsibilities of bt

- Maintain a map of active charts
- Track animation items per chart
- Start and stop animation loops
- Trigger `progress` and `complete` callbacks
- Synchronize animation ticks with the browser frame loop

### Internal State Structure

```mermaid
flowchart LR
    btInstance["bt Animation Engine"] --> ChartsMap["_charts Map"]
    ChartsMap --> ChartState["Per-Chart State"]
    ChartState --> Items["Animation Items[]"]
    ChartState --> Listeners["Listeners"]
    Listeners --> Progress["progress[]"]
    Listeners --> Complete["complete[]"]
```

Each chart has an internal animation state:

- `running`: Whether animations are active
- `items`: Animation objects to update
- `listeners`: Progress and completion callbacks
- `duration`: Maximum animation duration
- `start`: Timestamp when animation begins

---

## 4. Animation Lifecycle

### Animation Flow

```mermaid
sequenceDiagram
    participant Chart
    participant Animator as bt Engine
    participant Frame as requestAnimationFrame

    Chart->>Animator: add(animationItems)
    Chart->>Animator: start(chart)
    Animator->>Frame: requestAnimationFrame()
    Frame-->>Animator: frameTick(time)
    Animator->>Animator: update(chartItems)
    Animator->>Chart: draw()
    Animator->>Chart: notify(progress)
    Animator->>Chart: notify(complete)
```

### Execution Phases

1. **Registration**
   - Chart registers animation items via `add()`

2. **Start**
   - `start(chart)` marks animation as running
   - Duration computed from all animation items

3. **Frame Loop**
   - `_refresh()` schedules frame updates
   - `_update()` processes animation tick logic

4. **Tick Processing**
   - Active animations receive `tick(time)`
   - Expired animations are removed
   - Chart redraw triggered

5. **Completion**
   - When no items remain, `complete` listeners fire
   - Engine stops scheduling frames

---

## 5. Interaction with Chart Core

Chart Utilities Extensions Core Main does not directly implement:

- Chart controllers
- Scales
- Dataset logic
- Element rendering

Instead, it orchestrates them.

### Integration Overview

```mermaid
flowchart TD
    Animator["bt Animation Engine"] --> Controllers["Dataset Controllers"]
    Controllers --> Elements["Chart Elements"]
    Controllers --> Scales["Scales"]
    Animator --> Plugins["Plugins"]
    Animator --> ChartDraw["Chart.draw()"]
```

The animator drives redraw cycles. Controllers update element state. Elements render themselves. Plugins receive lifecycle notifications.

---

## 6. Data Flow During Animation

```mermaid
flowchart TD
    NewData["Dataset Mutation"] --> ControllerUpdate["Controller.update()"]
    ControllerUpdate --> CreateAnimations["Create Animation Items"]
    CreateAnimations --> AnimatorAdd["bt.add(chart, items)"]
    AnimatorAdd --> AnimatorStart["bt.start(chart)"]
    AnimatorStart --> FrameLoop["requestAnimationFrame"]
    FrameLoop --> TickUpdate["Item.tick(time)"]
    TickUpdate --> Redraw["Chart.draw()"]
```

This ensures:

- Smooth transitions between old and new dataset states
- Coordinated rendering across multiple elements
- Efficient frame scheduling

---

## 7. Event Notification Model

The animation engine exposes two primary listener types:

- `progress`
- `complete`

### Listener Model

```mermaid
flowchart TD
    Animator["bt Engine"] --> NotifyProgress["notify(progress)"]
    Animator --> NotifyComplete["notify(complete)"]
    NotifyProgress --> ChartCallbacks["Chart onProgress"]
    NotifyComplete --> ChartCallbacks
```

Listeners receive:

- Chart reference
- Total steps
- Current step
- Whether animation is initial

This allows higher layers to:

- Update UI state
- Trigger dependent calculations
- Synchronize external systems

---

## 8. Rendering and Performance Strategy

### Key Design Principles

- Single animation scheduler shared across charts
- Batched updates per frame
- Removal of inactive animation items
- Automatic stop when no animations remain
- Avoid redundant frame scheduling

### Frame Control Logic

```mermaid
flowchart TD
    Running["_running = true?"] -->|Yes| HasItems
    HasItems["Any active items?"] -->|Yes| ContinueLoop
    HasItems -->|No| StopLoop
    ContinueLoop --> RequestNext["requestAnimationFrame"]
    StopLoop --> SetRunningFalse["_running = false"]
```

This ensures the engine consumes CPU only while animations are active.

---

## 9. Relationship to Auxiliary Module

While Chart Utilities Extensions Core Main manages animation and coordination, related logic such as extended helpers, formatting, and advanced computation reside in:

- [Chart Utilities Extensions Core Auxiliary](chart-utilities-extensions-core-auxiliary/chart-utilities-extensions-core-auxiliary.md)

The separation allows:

- Clean runtime engine boundaries
- Modular extension support
- Easier maintainability

---

## 10. Summary

Chart Utilities Extensions Core Main provides the animation and rendering orchestration engine for the charting subsystem.

It:

- Drives animation timing
- Coordinates redraw cycles
- Dispatches lifecycle events
- Integrates controllers, elements, scales, and plugins

Without this module, chart updates would be static and uncoordinated. With it, the system achieves smooth transitions, synchronized updates, and extensible rendering behavior across the entire chart utilities stack.

It serves as the heartbeat of the chart runtime within the MeshCentral UI ecosystem.
