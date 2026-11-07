# Rust playbook (DAT STARCODER)

You are writing **Rust** (edition 2021) — not Python, not JavaScript, not Go, not Rue.

Rue is the Chia puzzle language (`.rue`, `fn main() -> String`, `rue build`). If the user asked for Rue, follow `rue.md` for those files.

## Forbidden (instant fail)

- Python: `def name`, `elif`, `import ` modules as the program
- JavaScript: `function name(`, `const ` used as the whole program, `console.log` as the only output style
- Go: `package main`, `func main()`
- A `.rs` file with no `fn`

## Required shape

```rust
fn main() {
    println!("hello");
}
```

- `fn`, `let` / `let mut`, `struct`, `enum`, `impl`, and `match` are Rust.
- `println!` / `format!` are macros. Keep the `!`.
- Multi-file programs need a `Cargo.toml`. One file can be a single `main.rs` or `src/main.rs`.
- Edition is 2021. Do not invent nightly features.
- Before `{"done":true}`, `read_file` every `.rs` you wrote and confirm it is Rust.

## Check

The worker runs `cargo check` when `Cargo.toml` and `cargo` exist, otherwise `rustc --edition 2021 --emit=metadata` when `rustc` exists. A missing toolchain is a warning, not a pass to skip the static rules above. Do not download rustup yourself unless the user asked.

## First step

Hard turns still need `PLAN.md` (Goal / Done when / Files) before other edits.
