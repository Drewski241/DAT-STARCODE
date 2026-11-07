# Rue playbook (DAT STARCODER)

You are writing **Rue** for Chia puzzles: https://rue-lang.com ([xch-dev/rue](https://github.com/xch-dev/rue)). It is a typed language that compiles to CLVM. It is not Rust, not ChiaLisp, and not the unrelated systems language at rue-lang.dev.

Docs: https://rue-lang.com. The example puzzles upstream publishes are educational and have not been audited.

## Forbidden (instant fail)

- Rust: `println!`, `format!`, `vec!`, `impl`, lifetimes (`<'a>`), `let mut`, `i32`
- `println(...)` and `@dbg` / `@import` / `@to_string` — those belong to a different language named Rue
- Python `def`
- `fn main(...) {` with no `->` return type
- Inventing a puzzle hash. Use `rue build --hash`
- `cargo install` during the turn. The operator installs `rue-cli`. A missing `rue` binary is a warning after the static checks

## Project

Start from the compiler's layout. In an empty workspace:

```bash
rue init
```

That writes `Rue.toml` and `puzzles/main.rue`. Do not run `rue init` again if `Rue.toml` already exists. A hand-written manifest must omit `compiler.version` or match the installed `rue` version, or `rue build` exits with "Project version mismatch".

Hello world (`puzzles/main.rue`):

```rue
fn main() -> String {
    "Hello, world!"
}

test fn hello() {
    assert main() == "Hello, world!";
}
```

A puzzle returns conditions. This is the shape from the Rue README:

```rue
fn main(public_key: PublicKey, conditions: List<Condition>) -> List<Condition> {
    let agg_sig = AggSigMe { public_key, message: tree_hash(conditions) };
    [agg_sig, ...conditions]
}
```

## Language

- Functions are `fn name(params) -> Type { }`. `main` is the entrypoint and is compiled as the program, not called.
- `export fn name` is another entrypoint: `rue build --export name`.
- `inline fn` is copied at each call site. Do not mark a recursive function `inline`.
- `extern fn` keeps a stable parameter layout for callers outside this program. Spread with `...name: List<T>`.
- Bindings are `let`. They are not mutable. `inline let` forces duplication.
- Structs are `struct Name { field: Type }`, then `Name { field: value }`. Cast with `as` when two structs share a layout.
- Types you can rely on: `Int`, `Bool`, `String`, `Bytes`, `Bytes32`, `PublicKey`, `List<T>`, `Any`, `nil`. There is no `i32`.
- Lists: `[a, b, ...rest]`. Pairs destructure as `let (first, rest) = (1, 2);`.
- `assert` raises on failure. `test fn name() { assert ...; }` is a test. `rue test` runs every test.
- `debug "message";` prints only when the program is built with `rue build --debug` (or `-d`). A normal `rue build` omits it, because CLVM has no print.
- `main` arguments are trusted by the type checker. For coin ids and puzzle hashes, accept `Bytes` and `assert value is Bytes32`, or call `calculate_coin_id`. Unchecked `Bytes32` concatenation is the CAT1 length bug.
- The standard library (on by default) includes conditions (`AggSigMe`, `Condition`), `tree_hash`, curry tree hash, merkle, singleton, and offers. Prefer those names over raw condition integers.

## CLI

The worker runs `rue build` and `rue test` before the turn can finish when `rue` is on `PATH` or `RUE_BIN` is set. You can also `run` these yourself:

| Command | What it does |
| --- | --- |
| `rue init [path]` | Create `Rue.toml` and `puzzles/main.rue` |
| `rue build [file]` | Compile the project, or one file, and print CLVM |
| `rue build --hex` | Serialized bytecode as hex |
| `rue build --hash` | Tree hash of the compiled program |
| `rue build --debug` | Keep `debug` messages and assertion text |
| `rue build --export <name>` | Compile that export instead of `main` |
| `rue build --all` | Write every export (next to the source, or `dist_dir` from `Rue.toml`) |
| `rue test [file]` | Run every `test fn` |
| `rue fmt [paths...]` | Format sources. `--check` fails when they are not formatted |
| `rue debug <program> [solution]` | Run CLVM. Pass source output from `rue build`, or `--hex` for bytecode |

`rue build` with no file uses `Rue.toml` in the current directory, else `main.rue` in the current directory. A single file with no manifest is `rue build puzzles/main.rue`.

## Check

Before `{"done":true}`, `read_file` every `.rue` file and confirm it has `fn`, a return type on `main`, and none of the forbidden forms. Then let verification run `rue build` and `rue test`.

## First step

Hard turns still need `PLAN.md` (Goal / Done when / Files) before other edits.
