# build_error reproduction for python: a syntax error. `uv run` (fake) compiles
# this with real python3 -m py_compile; the SyntaxError classifies as build_error.
def broken(:
    pass
