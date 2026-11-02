"""Deterministic filename lists and shell commands; never executes scanners."""
import itertools
import math
import re
import shlex
import string
from urllib.parse import urlsplit

MAX_LINES = 1_000_000
MAX_BYTES = 64 * 1024 * 1024
CHARSETS = {"digits": string.digits, "lower": string.ascii_lowercase,
            "upper": string.ascii_uppercase, "hex": "0123456789abcdef",
            "alnum": string.ascii_lowercase + string.digits}


class InputError(ValueError):
    pass


def clean_text(value, label, limit=1024):
    if not isinstance(value, str) or not value or len(value) > limit:
        raise InputError(f"{label} : texte requis, maximum {limit} caractères.")
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise InputError(f"{label} : caractères de contrôle interdits.")
    return value


def parse_mask(mask):
    clean_text(mask, "Motif", 256)
    if any(c in mask for c in '/\\') or mask in ('.', '..'):
        raise InputError("Le motif doit être un nom, sans chemin ni barre oblique.")
    parts = []
    pos = 0
    for match in re.finditer(r"\{([^{}]+)\}", mask):
        literal = mask[pos:match.start()]
        if '{' in literal or '}' in literal:
            raise InputError("Accolades mal formées.")
        if literal:
            parts.append(("literal", literal, 1, len(literal.encode('utf-8'))))
        fields = match.group(1).split(':')
        kind = fields[0]
        if kind in CHARSETS or kind == 'chars':
            expected = 3 if kind == 'chars' else 2
            if len(fields) != expected:
                raise InputError("Exemple : {digits:4} ou {chars:abc:2}.")
            chars = ''.join(dict.fromkeys(fields[1])) if kind == 'chars' else CHARSETS[kind]
            if not chars or any(c in chars for c in '/\\{}'):
                raise InputError("Alphabet vide ou invalide.")
            lengths = fields[-1].split('-')
            if not 1 <= len(lengths) <= 2 or not all(re.fullmatch(r'\d{1,2}', n) for n in lengths):
                raise InputError("Longueur attendue : 4 ou 2-4.")
            low, high = int(lengths[0]), int(lengths[-1])
            if not 1 <= low <= high <= 16:
                raise InputError("Les longueurs doivent être comprises entre 1 et 16.")
            count = sum(len(chars) ** n for n in range(low, high + 1))
            parts.append(('chars', (chars, low, high), count,
                          high * max(len(c.encode('utf-8')) for c in chars)))
        elif kind == 'range':
            if len(fields) not in (3, 4) or not all(re.fullmatch(r'\d{1,9}', n) for n in fields[1:]):
                raise InputError("Exemple : {range:2020:2026} ou {range:1:31:2}.")
            low, high = int(fields[1]), int(fields[2])
            width = int(fields[3]) if len(fields) == 4 else 0
            if low > high or high - low + 1 > MAX_LINES or width > 16:
                raise InputError("Plage inversée, trop grande ou largeur supérieure à 16.")
            parts.append(('range', (low, high, width), high-low+1, max(width, len(str(high)))))
        elif kind == 'words':
            if len(fields) != 2:
                raise InputError("Exemple : {words:janvier,fevrier,mars}.")
            words = tuple(dict.fromkeys(w.strip() for w in fields[1].split(',')))
            if not all(words):
                raise InputError("La liste de mots contient une entrée vide.")
            parts.append(('words', words, len(words), max(len(w.encode('utf-8')) for w in words)))
        else:
            raise InputError(f"Type inconnu : {kind}.")
        pos = match.end()
    tail = mask[pos:]
    if '{' in tail or '}' in tail:
        raise InputError("Accolades mal formées.")
    if tail:
        parts.append(('literal', tail, 1, len(tail.encode('utf-8'))))
    max_name_bytes = sum(p[3] for p in parts)
    if max_name_bytes > 255:
        raise InputError("Les noms générés dépasseraient 255 octets.")
    return parts


def values(part):
    kind, data, _, _ = part
    if kind == 'literal':
        yield data
    elif kind == 'words':
        yield from data
    elif kind == 'range':
        low, high, width = data
        for n in range(low, high + 1):
            yield str(n).zfill(width)
    else:
        chars, low, high = data
        for length in range(low, high + 1):
            for item in itertools.product(chars, repeat=length):
                yield ''.join(item)


def candidates(parts, prefix=''):
    if not parts:
        yield prefix
        return
    for value in values(parts[0]):
        yield from candidates(parts[1:], prefix + value)


def estimate(mask):
    parts = parse_mask(mask)
    count = math.prod(p[2] for p in parts)
    upper_bytes = count * (sum(p[3] for p in parts) + 1)
    allowed = count <= MAX_LINES and upper_bytes <= MAX_BYTES
    return {"count": count, "count_exact": str(count), "upper_bytes": upper_bytes, "allowed": allowed,
            "preview": list(itertools.islice(candidates(parts), 12)),
            "limits": {"lines": MAX_LINES, "bytes": MAX_BYTES}}


def write_list(mask, path):
    info = estimate(mask)
    if not info['allowed']:
        raise InputError("Liste trop grande : réduis la longueur, l’alphabet ou la plage.")
    count, size = 0, 0
    with path.open('xb') as stream:
        for value in candidates(parse_mask(mask)):
            line = (value + '\n').encode('utf-8')
            stream.write(line)
            size += len(line)
            count += 1
    return {"lines": count, "bytes": size}


def target_url(value):
    clean_text(value, "URL")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise InputError("URL ou port invalide.") from exc
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise InputError("Utilise une URL HTTP(S) complète, sans identifiants.")
    if parsed.query or parsed.fragment or any(c.isspace() for c in value):
        raise InputError("Indique une URL de dossier, sans requête, fragment ni espace.")
    return value.rstrip('/') + '/'


def make_commands(target, wordlist, directory_wordlist, threads):
    target = target_url(target)
    clean_text(directory_wordlist, "Dictionnaire de dossiers")
    if directory_wordlist.startswith('-'):
        raise InputError("Le chemin du dictionnaire ne doit pas commencer par un tiret.")
    if isinstance(threads, bool) or not isinstance(threads, int) or not 1 <= threads <= 100:
        raise InputError("Nombre de connexions : entier de 1 à 100.")
    # POSIX quoting is intended for the terminal on Kali.
    commands = {
        'directories': ['gobuster', 'dir', '-u', target, '-w', directory_wordlist,
                        '-t', str(threads), '-o', 'dossiers-resultats.txt'],
        'files': ['gobuster', 'dir', '-u', target, '-w', wordlist,
                  '-t', str(threads), '-o', 'fichiers-resultats.txt'],
        'ffuf': ['ffuf', '-u', target + 'FUZZ', '-w', wordlist,
                 '-t', str(threads), '-of', 'json', '-o', 'fichiers-resultats.json'],
    }
    return {key: shlex.join(args) for key, args in commands.items()}
