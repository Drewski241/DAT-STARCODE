# Rue playbook (DAT STARCODER)

You are writing **Rue** (https://rue-lang.dev, Steve Klabnik’s experimental systems language) — not Rust, not Python.

Rue is early-stage. Syntax still moves. Do not invent Rust features to fill gaps.

## Forbidden (instant fail)

- Rust macros: `println!`, `format!`, `vec!`
- `impl` blocks — methods live on the struct, not in `impl`
- Rust lifetimes: `<'a>`, `<'b>`
- Python `def`
- `fn main(...) {` with no `->` return type. `main` returns a status: `fn main() -> i32`

## Required shape

```rue
fn fib(n: i32) -> i32 {
    if n <= 1 { n } else { fib(n - 1) + fib(n - 2) }
}

fn main() -> i32 {
    println("hello");
    @dbg(fib(10));
    0
}
```

- Functions are `fn name(params) -> type { }`.
- Bindings are `let` and `let mut`.
- Structs are `struct Name { field: type }`.
- `println("...")` is a function. There is no `!`.
- `@import("std")`, `@dbg`, and `@to_string` are real forms.
- Put the program in a `.rue` file.
- Before `{"done":true}`, `read_file` the `.rue` file and confirm it has `fn`, `fn main() ->`, and no `println!` / `impl` / `<'`.

## Check

Static rules always run. If `rue` is on `PATH` or `RUE_BIN` points at the compiler (`scripts/rue-bin` in the rue repo), the worker compiles with that binary. The worker does not clone `rue-language/rue` or install Buck2. A missing compiler is a warning; the forbidden forms above still fail the turn.

## First step

Hard turns still need `PLAN.md` (Goal / Done when / Files) before other edits.
