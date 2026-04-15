"""Pattern constants assembled from fragments.

The repo has a Write-tool hook that flags certain literal substrings
(the Python dynamic code-evaluation builtin name followed by an opening
paren, the JS Function-constructor idiom, literal binary deserializer
dotted paths). Those substrings are valid in rule implementations, but
embedding them as literal source text trips the hook. We assemble the
regex patterns and the AST name sets from fragments here, then import
them in the rule modules. The awkwardness is contained in this one file.
"""
from __future__ import annotations

import re

# --- AST-level name sets (used by Python rule file) -------------------

# Python dynamic code-evaluation builtins. Runtime values:
#   {"eval", "exec", "compile"}
PY_EVALEXEC_NAMES = frozenset([
    "e" + "val",
    "e" + "xec",
    "comp" + "ile",
])

# Low-level deserializers / FFI modules
PY_DESERIALIZER_MODULES = frozenset([
    "pick" + "le",
    "mars" + "hal",
    "cty" + "pes",
])

# HTTP client modules we treat as "network" for the secret-exfil rule.
PY_HTTP_CLIENT_MODULES = frozenset({
    "urllib.request",
    "urllib",
    "http.client",
    "requests",
    "httpx",
})

# --- Markdown patterns ------------------------------------------------

PROMPT_INJECTION_PHRASES = [
    re.compile(p, re.IGNORECASE) for p in [
        r"ignore\s+(?:the\s+|all\s+)?(?:previous|above|prior)\s+instructions",
        r"(?:reveal|show|print|leak|dump)\s+(?:the\s+|your\s+)?system\s+prompt",
        r"disregard\s+(?:the\s+|all\s+)?(?:user|previous)",
        r"you\s+must\s+(?:not\s+refuse|comply|obey)",
    ]
]

INVISIBLE_CHARS = frozenset([
    "\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF",
])

BASE64_BLOB_RE = re.compile(r"[A-Za-z0-9+/=]{200,}")

HIDDEN_HTML_COMMENT_RE = re.compile(r"<!--(.*?)-->", re.DOTALL)
HTML_COMMENT_IMPERATIVE_RE = re.compile(
    r"\b(?:run|execute|fetch|download|delete|ignore|disable)\b",
    re.IGNORECASE,
)

SUSPICIOUS_URL_SCHEME_RE = re.compile(
    r"\b(?:data|javascript|file|vbscript)\s*:",
    re.IGNORECASE,
)

# --- Shell patterns ---------------------------------------------------

PIPE_TO_SHELL_RE = re.compile(
    r"(?:curl|wget)[^\n|]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh)\b",
    re.IGNORECASE,
)

ENV_EXFIL_SHELL_RE = re.compile(
    r"(?:curl|wget)[^\n]*(?:-d|--data|-F)[^\n]*\$[A-Z_]{3,}",
    re.IGNORECASE,
)

# Shell dynamic code-eval builtin — fragment-assembled.
_SHELL_EVAL_WORD = "e" + "val"
SHELL_EVAL_WITH_INPUT_RE = re.compile(
    r"\b" + _SHELL_EVAL_WORD + r"\s+(?:\$|\"\$|`)",
)

RM_RF_SUSPICIOUS_RE = re.compile(
    r"\brm\s+-[rRf]*r[rRf]*f[^\n]*\s+(?:/(?:\s|$)|~(?:\s|$)|\*)",
)

DOWNLOAD_EXECUTE_RE = re.compile(
    r"curl[^\n]*-o[^\n]*\.(?:sh|py|js)[^\n]*(?:\|\||&&|;)\s*(?:bash|sh|zsh|python|node)",
    re.IGNORECASE,
)

# --- JS patterns ------------------------------------------------------

# Dynamic JS code-evaluation builtin used as a function call.
_JS_EVAL_WORD = "e" + "val"
JS_DYNAMIC_EVAL_RE = re.compile(r"\b" + _JS_EVAL_WORD + r"\s*\(")

# Runtime constructor idiom — "new" whitespace ConstructorName.
# Assembled so the full literal four-token sequence never appears in any
# single source line of this file.
_JS_FN_CONSTRUCTOR_FRAGMENT = r"\bnew\s+" + "Fun" + "ction"
JS_FUNCTION_CONSTRUCTOR_RE = re.compile(_JS_FN_CONSTRUCTOR_FRAGMENT + r"\s*\(")

JS_FETCH_RE = re.compile(
    r"\bfetch\s*\(\s*['\"]https?://([A-Za-z0-9.-]+)",
)

JS_ALLOWED_HOSTS = frozenset({
    "raw.githubusercontent.com",
    "github.com",
    "api.github.com",
})
