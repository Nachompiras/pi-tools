# Token Speed Status Design

## Goal

Add generation-performance metrics to Pi without replacing or reimplementing its built-in footer. The extension will add one compact status line:

```text
TPS 45.2 | AVG 38.1 | TTFT 0.8s
```

The built-in path, token, context, cost, model, provider, and thinking-level lines remain unchanged.

## Scope

The status reports:

- **TPS**: live generation speed while a response streams; after streaming, the measured speed of the latest completed response.
- **AVG**: output-token-weighted average generation speed for completed responses in the current session.
- **TTFT**: mean time to first output across completed provider requests in the current session.

Text, thinking, and streamed tool-call argument deltas count as output activity. The extension does not persist metrics across sessions, replace the footer, call external services, or add user configuration.

## Architecture

Create a focused extension under `extensions/token-speed/`:

- `index.ts` wires Pi lifecycle events to a tracker and publishes the formatted status through `ctx.ui.setStatus("token-speed", ...)`.
- `tracker.ts` owns timing, rolling-window samples, completed-response aggregates, and formatting-independent metric calculations.
- `tracker.test.ts` exercises calculations with a controllable clock and synthetic Pi events.

Separating the tracker from Pi event wiring keeps timing logic deterministic and independently testable.

## Data Flow

1. `session_start` clears all in-memory samples and displays placeholders.
2. `before_provider_request` records the request start time for TTFT.
3. `message_start` establishes the current assistant response.
4. `message_update` observes `text_delta`, `thinking_delta`, and `toolcall_delta` events:
   - The first non-empty delta records time to first token.
   - Each delta contributes an estimated token count to a five-second rolling window.
   - The status line is refreshed with live TPS.
5. `message_end` for an assistant message:
   - Uses provider-reported `message.usage.output` as the authoritative completed token count.
   - Measures decode duration from first output to last output.
   - Stores the completed response TPS as the idle `TPS` value.
   - Adds output tokens and decode duration to session aggregates for weighted `AVG`.
   - Adds valid TTFT to the session mean.
6. `agent_end`, aborted/error messages, session replacement, and `session_shutdown` clear transient response state so stale streams cannot affect later responses.

## Metric Definitions

### Live TPS

Live TPS is estimated from output deltas in a five-second sliding window:

```text
estimated tokens in window / elapsed covered by window
```

Delta token estimates use UTF-8 byte length divided by five, rounded up per non-empty delta. This is responsive and provider-independent but explicitly approximate.

### Completed TPS

```text
provider-reported output tokens / seconds from first output to last output
```

Responses without output tokens or a valid decode interval do not replace the last valid completed TPS.

### Session AVG

```text
sum of provider-reported output tokens / sum of valid decode durations
```

This is weighted by output volume rather than averaging per-response rates.

### TTFT

```text
mean(first non-empty output delta time - provider request start time)
```

Only requests with both timestamps contribute. Tool execution time between provider requests is not included.

## Presentation

Pi's supported `setStatus()` API renders extension statuses below the built-in footer. This preserves the native footer and avoids copying private footer behavior that could change between Pi releases.

Formatting rules:

- Rates at or above 100 use no decimals.
- Rates from 10 to 99.9 use one decimal.
- Lower positive rates use two decimals.
- TTFT uses seconds with one decimal.
- Unavailable values render as `-`.
- The whole line uses Pi's muted theme color.

## Error Handling and Lifecycle

- Ignore empty deltas, non-assistant messages, missing usage, non-finite values, and out-of-order timestamps.
- Never divide by zero or display `NaN`/`Infinity`.
- An aborted or failed response may contribute TTFT only if Pi delivers a completed assistant message with valid usage and timing; otherwise it is discarded.
- Session start and shutdown reset transient state.
- The extension performs no file, network, subprocess, or background timer work.

## Testing

Unit tests will verify:

- Live TPS over a five-second sliding window.
- Text, thinking, and tool-call deltas are counted.
- Completed TPS uses provider usage rather than the live estimate.
- Session AVG is output-token weighted.
- TTFT uses the first non-empty output delta.
- Missing usage, empty output, zero durations, aborted responses, and invalid timestamps are ignored safely.
- Session reset removes previous aggregates and last-response metrics.
- Formatting never emits non-finite values.

Repository verification will run the focused tests, the full test suite, and TypeScript type checking.
