# T47 Web Enumeration Prep

🌐 **Language:** English | [Français](README.fr.md)

Generate filename wordlists from patterns and prepare Gobuster or ffuf commands for web enumeration. The interface is in English. The application does not run scans or contact targets; commands are executed separately by the user.

## Start

Requires Python 3.10 or later; no third-party Python packages are required. From this directory:

```sh
python3 app.py
```

Open `http://127.0.0.1:8765` on the same machine. Use `--port` to select another port. The application has a local Python server and cannot be opened directly as an HTML file.

## Use

Preview a pattern, generate its list, then provide the target and directory wordlist to prepare commands. For example, `rapport-{digits:4}.pdf` generates names from `rapport-0000.pdf` to `rapport-9999.pdf`. Generated lists are limited to one million lines and 64 MiB and stored locally under `data/webenum/`, which is ignored by Git.

Gobuster or ffuf must be installed separately to run their commands. Commands are quoted for a POSIX shell, intended for Kali Linux; verify paths and available options on the machine where they will run. They use GNU `mktemp` to allocate a new output file for each run and display its path; a failed run may leave an empty file. Generated list paths refer to the machine running this application; when using another machine, transfer the list and adjust the path. The tool does not interpret scanner responses.

Recipes are saved in the browser for the same origin and can be exported or imported as JSON. The existing address, port, and recipe storage key are preserved from the previous version, so recipes stored for that same browser origin remain accessible. The previous local list directory was empty at transfer time.

Run existing checks with `python3 -m unittest discover -s tests -v`. The SECTION 21 styles, local fonts and their OFL licence texts are included in `web/assets/t47-v2/`.

## Licence

T47 Web Enumeration Prep is part of Teriak Toolbox under the repository's GPL v3 licence. The bundled fonts retain their respective OFL licences.
