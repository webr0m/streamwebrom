#!/usr/bin/env python3
"""Tiny static check for the browser modules (no npm needed):
- every identifier used is declared somewhere in the module or is a browser global
- every named import exists as an export of the imported module
Scope handling is intentionally loose (any declaration in the file counts), so
it catches typos and missing imports, not shadowing bugs."""
import os, sys, esprima

GLOBALS = set("""window document CSS Worker postMessage navigator location history localStorage sessionStorage console setTimeout clearTimeout
setInterval clearInterval requestAnimationFrame cancelAnimationFrame fetch URL URLSearchParams JSON Math Date Number String
Boolean Object Array Promise Map Set WeakMap Error TypeError RegExp Uint8Array Float32Array Infinity NaN isNaN parseInt
parseFloat encodeURIComponent decodeURIComponent alert confirm prompt crypto performance Image Audio AudioContext
MediaStream MediaStreamTrack RTCPeerConnection RTCRtpSender RTCRtpReceiver WebSocket EventTarget CustomEvent Event
HTMLMediaElement HTMLVideoElement Node FileReader Blob self caches clients undefined globalThis structuredClone
OffscreenCanvas ImageBitmap createImageBitmap Path2D DOMException queueMicrotask AbortController TextEncoder TextDecoder
arguments matchMedia screen getComputedStyle ResizeObserver IntersectionObserver MutationObserver""".split())

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

def main(root):
    files = [os.path.join(root, f) for f in sorted(os.listdir(root)) if f.endswith(".js")]
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
    print("jslint:", "OK" if not bad else f"{bad} problem(s)")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "web/js"))
