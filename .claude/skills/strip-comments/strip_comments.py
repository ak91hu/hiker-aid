import sys

KEEP_MARKERS = ("XXE prevention", "package-private for unit testing")


def strip(text):
    crlf = "\r\n" in text
    src = text.replace("\r\n", "\n")
    n = len(src)
    i = 0
    out = []
    buf = []
    orig_nonws = False
    out_nonws = False

    def flush():
        nonlocal buf, orig_nonws, out_nonws
        if not (orig_nonws and not out_nonws):
            out.append("".join(buf).rstrip())
        buf = []
        orig_nonws = False
        out_nonws = False

    while i < n:
        c = src[i]
        if c == "\n":
            flush()
            i += 1
            continue
        if not c.isspace():
            orig_nonws = True
        if c == '"' or c == "'" or c == "`":
            q = c
            buf.append(c); out_nonws = True; i += 1
            while i < n:
                d = src[i]
                buf.append(d)
                if d == "\\" and i + 1 < n:
                    buf.append(src[i + 1]); i += 2; continue
                i += 1
                if d == q:
                    break
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            if j == -1:
                j = n
            comment = src[i:j]
            if any(m in comment for m in KEEP_MARKERS):
                buf.append(comment); out_nonws = True
            else:
                while buf and buf[-1] in (" ", "\t"):
                    buf.pop()
            i = j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            if j == -1:
                j = n - 2
            comment = src[i:j + 2]
            if any(m in comment for m in KEEP_MARKERS):
                buf.append(comment); out_nonws = True
            else:
                while buf and buf[-1] in (" ", "\t"):
                    buf.pop()
                while j + 2 < n and src[j + 2] in (" ", "\t"):
                    j += 1
                for _ in range(comment.count("\n")):
                    flush()
            i = j + 2
            continue
        buf.append(c)
        if not c.isspace():
            out_nonws = True
        i += 1

    flush()
    result = []
    blank = 0
    for line in out:
        if line == "":
            blank += 1
            if blank >= 2:
                continue
        else:
            blank = 0
        result.append(line)
    while result and result[-1] == "":
        result.pop()
    while result and result[0] == "":
        result.pop(0)
    text_out = "\n".join(result)
    if text.endswith("\n"):
        text_out += "\n"
    if crlf:
        text_out = text_out.replace("\n", "\r\n")
    return text_out


for path in sys.argv[1:]:
    with open(path, "r", encoding="utf-8", newline="") as f:
        original = f.read()
    stripped = strip(original)
    if stripped != original:
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(stripped)
        print("stripped:", path)
    else:
        print("unchanged:", path)
