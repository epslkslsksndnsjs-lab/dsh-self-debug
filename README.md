# dsh-self-debug

A native [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh) plugin that gives the model one tool — `self_debug` — to discover and
diagnose its own errors within a single task: detect project type, run the
matching verification commands, and return a deterministic, pure-text report
with structured attribution (failure class + next-step investigation hints),
not just raw error output.

Status: design phase. See [ADR-0001](docs/adr/0001-in-task-self-check-tool-plugin-for-dsh.md)
for the full decision record. No marketplace publish before the acceptance
benchmark (with-plugin vs without-plugin task success rate) produces numbers.

## License

MIT
