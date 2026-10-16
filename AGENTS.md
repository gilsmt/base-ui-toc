Do it right the first time: the design that lands in the codebase should be the correct one, with no intentional debt in that surface. A problem solved in design costs less than one solved in implementation, which costs less than one solved in production. "Right the first time" describes the landed output, not the exploration that produced it — see simplicity below.

When rules conflict, prefer in order: correctness and safety of the change surface, then local coherence in files you already touch, then YAGNI, then style. If a tradeoff is required, choose correctness and robustness over short-term convenience or shortcuts.
Leave the codebase better than you found it. Do not preserve complexity just because it already exists. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Suggest solutions or alternatives I didn’t think about and anticipate my needs. When the request is wrong, unsafe, or would not work, block it and offer alternatives. When it is merely suboptimal, challenge once with a concrete alternative, then execute the user's choice unless a hard constraint still fails. If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Reframe from first principles when that reaches a better answer.

Study and plan before implementing. Identify recurring patterns and design influences in the code. Keep rules or constraints of the task in mind.

Trace how parts connect, such as data flow between functions, stage dependencies, or what module owns what.

Read the full implementation of what you change and its direct callers/callees, not just the signatures, and not the whole repo. Do not rely on search snippets for broad changes.

It is not about formatting or syntax. Linters handle that. It is about how to think, how to make decisions, and what to value when building software.

Simple and elegant systems are easier to design correctly, more efficient in execution, and more reliable. That simplicity requires hard work and discipline.

Simplicity is not the first attempt. It is the hardest revision. It takes thought, multiple passes, and the willingness to throw work away. The goal is to find the idea that solves multiple problems at once.

Follow the rationale that each function should have a single, named responsibility. Keep functions small enough to reason about in isolation such that it is understandable and verifiable as a logical unit (self-contained). If you need to trace external state to understand it, it's too large or too coupled, step back and consider whether it should be broken up.

Strive for writing fully functional bug-free code by using best practices and minimizing room for error by, for example, making illegal states unrepresentable.

Prohibit over-encapsulation and over-abstraction of code.

Avoid unnecessary code indirection. Extract when the same reason to change applies in two or more modules and the name is obvious; similar code with different futures may stay duplicated. Extracting a className string into a constant just because it is used twice is not justified. Keep logic in one function unless composable or reusable. Do not extract single-use helpers preemptively; inline at the call site unless reused, hiding a genuinely complex boundary, or carrying a clear independent name that improves the caller.

Follow YAGNI. Prefer the smallest clear unit, not the fewest lines — one-liners only for pure expressions with no branching, I/O, or error paths.

Control flow: Reduce nesting. Avoid else statements. Prefer early returns.

Do not chain multiple array iteration methods (`map`, `filter`, `reduce`, `flatMap`, etc.). Each step makes one intermediate array, one more pass, and more work for the garbage collector.

Handle errors at the appropriate scopes. Never silently swallow exceptions. If you think an error cannot happen, assert that assumption explicitly.

Never compromise type safety: avoid `any`, `!` (non-null assertion), and `as Type` casting as they usually indicate wrong assumptions or bad implementation. A cast is allowed only at a trust boundary (SDK, ORM, framework) when the invariant is runtime-checked or guaranteed by a typed wrapper one layer in. Prefer narrowing (`zod`, predicates, exhaustiveness). If you need a cast deeper than the boundary, fix the model. Validate unknown values once at the boundary that owns them. Pass typed values inward instead of repeating `typeof value === "object"` and property-existence checks. Do not defensively revalidate values already guaranteed by a schema, constructor, or internal type.

Cast a value to boolean with `!!value`, not with a `Boolean(value)` call. TypeScript narrows a type through `!!` but not through a `Boolean()` call, so `if (!!value)` rules out the `undefined` branch while `if (Boolean(value))` leaves the value possibly undefined. The same holds inside a type predicate, where `!!value` narrows and `Boolean(value)` does not. `.filter(Boolean)` passes the function as a predicate instead of casting a single value. Keep it as it is.

Declare variables at the smallest possible scope. Minimize the number of variables in play at any point. This reduces the probability of using the wrong variable and makes code easier to reason about. Calculate or check variables close to where they are used. Do not introduce variables before they are needed or leave them around when they are not.

Plugin architectures allow for extensibility and isolation; most functionality should live in plugins, not the core, enabling parallel development and future-proofing. Apply a plugin boundary when pluggability is itself a current requirement (sync adapters, export formats, AI providers). YAGNI governs speculative features — do not extract a plugin boundary for a single implementation.

Minimize risk by anticipating what’s most likely to fail (platforms, language changes, hardware, people...) and insulating your system from those points of failure.

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it. Keep helpers close to the code they support, below the main export when that improves readability.

Anchor design decisions on the user's primary task or focus, to make sure the user can complete those tasks easily, not overwhelmed by unrelated UI clutter or user flows. Our UI should help users complete their tasks, not hinder them.

Constants are module-level and UPPER_SNAKE_CASE: Physics constants, selectors, and thresholds are declared at the top of the file, never inside the component.

Inline single-use values when the expression is obvious in place. Keep a name when it encodes units, domain meaning, or a non-obvious intermediate — even if used once.

When refactoring or moving code, preserve existing comments unless they are explicitly made obsolete by the change.

Follow [BaseUI conventions](https://base-ui.com/react/handbook/composition).

Every component should be co-located into a single file with its parts, and should use a common, composable interface, making them predictable.

Avoid duplicating logic where necessary: If two components can share logic (such as event handlers), define the logic/handlers in the parent and share it through a context to the child; use the existing context if it exists.

## Naming conventions

Great names capture what a thing actually is or does. Append qualifiers to names. Units, bounds, and modifiers come at the end. This groups related variables together and makes scanning easier. The adequate variables should also follow a regular prefix convention, such as `is`, `has`, `can`, `should` or `allow`.

## Comments in code

Use mostly ASD-STE100 Simplified Technical English. Active-voice, simple tenses, single-meaning sentences, and consistent terms. Avoid dense, jargon-heavy, or ambiguous prose.

Explain why, not what, and only when a future reader (with no access to this PR or chat) would otherwise be confused.

Never log change history or chat context in code — no "previously did X, now does Y", "per <task/PR>", "changed because…", or "AI:"/"agent:" notes.
