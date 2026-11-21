#!/usr/bin/env python3
"""Tiny static check for the browser modules (no npm needed):
- every identifier used is declared somewhere in the module or is a browser global
- every named import exists as an export of the imported module
Scope handling is intentionally loose (any declaration in the file counts), so
it catches typos and missing imports, not shadowing bugs."""
import os, sys, json, esprima

GLOBALS = set("""window document CSS Worker AbortSignal postMessage navigator location history localStorage sessionStorage console setTimeout clearTimeout
setInterval clearInterval requestAnimationFrame cancelAnimationFrame fetch URL URLSearchParams JSON Math Date Number String
Boolean BigInt Object Array Promise Map Set WeakMap WeakSet Error TypeError RegExp Uint8Array Float32Array Infinity NaN isNaN parseInt
parseFloat encodeURIComponent decodeURIComponent alert confirm prompt crypto performance Image Audio AudioContext
MediaStream MediaStreamTrack RTCPeerConnection RTCRtpSender RTCRtpReceiver WebSocket EventTarget CustomEvent Event
HTMLMediaElement HTMLVideoElement Node FileReader Blob self caches clients undefined globalThis structuredClone
OffscreenCanvas ImageBitmap createImageBitmap Path2D DOMException queueMicrotask AbortController TextEncoder TextDecoder
arguments matchMedia screen getComputedStyle ResizeObserver IntersectionObserver MutationObserver""".split())
GLOBALS.update("AudioWorkletNode AudioWorkletProcessor registerProcessor sampleRate ArrayBuffer".split())

def walk(node, fn, parent=None, key=None):
    if isinstance(node, list):
        for n in node: walk(n, fn, parent, key)
        return
    if not hasattr(node, "type"): return
    fn(node, parent, key)
    for k, v in vars(node).items():
        if k in ("type", "range", "loc"): continue
        if isinstance(v, list) or hasattr(v, "type"): walk(v, fn, node, k)

def pattern_names(p, out):
    if p is None: return
    t = p.type
    if t == "Identifier": out.add(p.name)
    elif t == "ObjectPattern":
        for pr in p.properties:
            pattern_names(pr.value if pr.type == "Property" else pr.argument, out)
    elif t == "ArrayPattern":
        for e in p.elements: pattern_names(e, out)
    elif t == "RestElement": pattern_names(p.argument, out)
    elif t == "AssignmentPattern": pattern_names(p.left, out)

def analyse(path):
    src = open(path, encoding="utf-8").read()
    # esprima only parses ES2017: lower ES2020 operators for parsing purposes only.
    import re
    src = src.replace("import.meta", '({url: ""})')
    src = re.sub(r"\?\.(?=[\[(])", "", src)
    src = src.replace("?.", ".").replace("??=", "||=").replace("??", "||")
    src = re.sub(r"catch\s*\{", "catch (_e) {", src)
    src = re.sub(r"(\d)_(\d)", r"\1\2", src)
    src = re.sub(r"(\w|\])\s*\|\|=", r"\1 = \1 ||", src)
    tree = esprima.parseModule(src, {"range": False})
    declared, used, imports, exports = set(), [], [], set()
    def fn(n, parent, key):
        t = n.type
        if t == "ImportDeclaration":
            for s in n.specifiers:
                declared.add(s.local.name)
                if s.type == "ImportSpecifier": imports.append((n.source.value, s.imported.name))
        elif t == "VariableDeclarator": pattern_names(n.id, declared)
        elif t in ("FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"):
            if getattr(n, "id", None): declared.add(n.id.name)
            for p in n.params: pattern_names(p, declared)
        elif t == "ClassDeclaration" and n.id: declared.add(n.id.name)
        elif t == "CatchClause" and n.param: pattern_names(n.param, declared)
        elif t == "ExportNamedDeclaration":
            d = n.declaration
            if d is not None:
                if d.type == "VariableDeclaration":
                    for v in d.declarations: pattern_names(v.id, exports)
                elif d.id: exports.add(d.id.name)
            for s in n.specifiers or []: exports.add(s.exported.name)
        elif t == "Identifier":
            if parent is not None:
                if parent.type in ("MemberExpression",) and key == "property" and not parent.computed: return
                if parent.type == "Property" and key == "key" and not parent.computed: return
                if parent.type == "MethodDefinition" and key == "key": return
                if parent.type in ("ImportSpecifier", "ImportDefaultSpecifier", "ExportSpecifier", "LabeledStatement", "BreakStatement", "ContinueStatement"): return
            used.append(n.name)
    walk(tree.body, fn)
    return declared, used, imports, exports

def built_outputs(root):
    """Names of the files `scripts/build-ui.mjs` emitted into this directory.

    The check below is a source-code check: it reasons about declarations, imports and
    browser globals. Vite's hashed chunks are bundled output, and the parser the runners
    install — esprima 4.0.1 from PyPI, since Debian bookworm has no `python3-esprima`
    package at all — stops at the first top-level `await` in `js/studio-<hash>.js`
    ("Line 2: Unexpected identifier", char 1013) because it predates ES2022. Lowering the
    operators that `analyse` already lowers changes nothing there: the same offset fails
    parsed raw and lowered. Measured over all four chunks, though, the lowering does carry
    three of them (`import.meta`, `?.`, `catch {`) across, so the rule is not "esprima trips
    on this one file" — it is that build output is not what this linter reads, and the only
    honest way to keep it out is the manifest the build publishes alongside them."""
    manifest = os.path.join(root, "sw-assets.json")
    if not os.path.exists(manifest):
        return set()
    try:
        listed = json.load(open(manifest))
    except (ValueError, OSError):
        return set()
    prefix = os.path.basename(os.path.abspath(root))
    names = set()
    for entry in listed:
        if not isinstance(entry, str) or not entry.endswith(".js"):
            continue
        # Entries are relative to web/ ("js/studio-<hash>.js"), so the segment that
        # names the file is the last one; matching it keeps the rule independent of how
        # the caller spelled the directory. A hand-written module could only collide by
        # carrying the exact name Vite just emitted into it, in which case it is gone.
        if entry.split("/")[-2] == prefix or entry.count("/") == 1:
            names.add(entry.rsplit("/", 1)[-1])
    return names

def main(root):
    skipped = built_outputs(root)
    files = [os.path.join(root, f) for f in sorted(os.listdir(root))
             if f.endswith(".js") and f not in skipped]
    info = {os.path.basename(f): analyse(f) for f in files}
    bad = 0
    for name, (declared, used, imports, _) in info.items():
        for u in sorted(set(used) - declared - GLOBALS):
            print(f"{name}: undeclared identifier '{u}'"); bad += 1
        for mod, imp in imports:
            target = info.get(os.path.basename(mod))
            if target is None: continue
            if imp not in target[3]:
                print(f"{name}: '{imp}' is not exported by {mod}"); bad += 1
        unused = {d for d in declared if d not in used}
        for (mod, imp) in imports:
            if imp in unused: print(f"{name}: warning: import '{imp}' unused")
    print(f"jslint: {len(info)} módulo(s) fuente, {len(skipped)} chunk(s) de build fuera "
          f"del parser: " + ("OK" if not bad else f"{bad} problem(s)"))
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "web/js"))
