import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app import AppServer
from modules.webenum.core import InputError, estimate, make_commands, parse_mask, candidates, write_list


class ListTests(unittest.TestCase):
    def test_digits_preserve_zero_and_order(self):
        info = estimate('rapport-{digits:4}.pdf')
        self.assertEqual(info['count'], 10000)
        self.assertEqual(info['preview'][0], 'rapport-0000.pdf')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'list.txt'
            result = write_list('rapport-{digits:4}.pdf', path)
            self.assertEqual(result, {'lines': 10000, 'bytes': 170000})
            lines = path.read_bytes().splitlines()
            self.assertEqual(lines[-1], b'rapport-9999.pdf')
            self.assertEqual(len(set(lines)), 10000)

    def test_combined_blocks_and_variable_lengths(self):
        mask = 'r-{range:2024:2025}-{range:1:2:2}-{words:a,b,a}.pdf'
        names = list(candidates(parse_mask(mask)))
        self.assertEqual(len(names), 8)
        self.assertEqual(names[0], 'r-2024-01-a.pdf')
        self.assertEqual(names[-1], 'r-2025-02-b.pdf')
        self.assertEqual(list(candidates(parse_mask('{chars:ab:1-2}'))), ['a','b','aa','ab','ba','bb'])

    def test_large_list_blocked_without_file(self):
        self.assertFalse(estimate('{lower:8}')['allowed'])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'list.txt'
            with self.assertRaises(InputError):
                write_list('{lower:8}', path)
            self.assertFalse(path.exists())

    def test_invalid_masks(self):
        for mask in ['../x', '{digits:0}', '{digits:5-2}', '{oops:2}', '{words:a,}',
                     '{range:5:2}', '{digits:2', 'abc}', 'x\ny', '{chars::2}']:
            with self.subTest(mask=mask), self.assertRaises(InputError):
                estimate(mask)

    def test_shell_arguments_roundtrip(self):
        path = "/tmp/a b/it's-list.txt"
        result = make_commands('http://127.0.0.1:8000/docs', path, '/tmp/dirs.txt', 10)
        args = shlex.split(result['files'])
        self.assertEqual(args[args.index('-w')+1], path)
        self.assertEqual(args[args.index('-u')+1], 'http://127.0.0.1:8000/docs/')
        self.assertNotIn('-x', args)
        ffuf_args = shlex.split(result['ffuf'])
        self.assertEqual(ffuf_args[ffuf_args.index('-u')+1], 'http://127.0.0.1:8000/docs/FUZZ')

    @unittest.skipUnless(os.name == 'posix' and shutil.which('mktemp'), 'Requires POSIX shell and GNU mktemp')
    def test_each_command_execution_allocates_a_fresh_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            binary = root / 'gobuster'
            binary.write_text('#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n'
                              '  if [ "$1" = "-o" ]; then shift; printf "test\\n" > "$1"; exit; fi\n'
                              '  shift\ndone\nexit 1\n')
            binary.chmod(0o755)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'])
            command = make_commands('http://127.0.0.1:8000', '/tmp/list.txt', '/tmp/dirs.txt', 10)['files']
            for _ in range(2):
                run = subprocess.run(command, shell=True, cwd=root, env=env, text=True, capture_output=True, check=True)
                self.assertIn('Results: ./webenum-files-', run.stderr)
            outputs = list(root.glob('webenum-files-*.txt'))
            self.assertEqual(len(outputs), 2)
            self.assertTrue(all(p.read_text() == 'test\n' for p in outputs))

    @unittest.skipUnless(os.name == 'posix', 'Requires POSIX shell')
    def test_failed_output_allocation_does_not_run_scanner(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, body in [('mktemp', 'exit 1'), ('gobuster', 'touch called')]:
                binary = root / name
                binary.write_text('#!/bin/sh\n' + body + '\n')
                binary.chmod(0o755)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.defpath)
            command = make_commands('http://127.0.0.1:8000', '/tmp/list.txt', '/tmp/dirs.txt', 10)['files']
            run = subprocess.run(command, shell=True, cwd=root, env=env, capture_output=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertFalse((root / 'called').exists())

    def test_invalid_targets(self):
        for target in ['127.0.0.1', 'file:///etc/passwd', 'http://u:p@host/',
                       'http://host:99999/', 'http://host/?x=1', 'http://host/#x']:
            with self.subTest(target=target), self.assertRaises(InputError):
                make_commands(target, '/tmp/list.txt', '/tmp/dirs.txt', 10)


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.server = AppServer(('127.0.0.1', 0), Path(self.folder.name))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.folder.cleanup()

    def post(self, route, data, token=True, origin=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['X-T47-Token'] = self.server.token
        if origin:
            headers['Origin'] = origin
        with urlopen(Request(self.base + route, data=json.dumps(data).encode(), headers=headers)) as response:
            return json.load(response)

    def test_generate_download_commands_and_restart(self):
        item = self.post('/api/webenum/generate', {'mask': 'r-{range:1:3:2}.pdf'})
        with urlopen(self.base + '/download/webenum/' + item['id']) as response:
            self.assertEqual(response.read(), b'r-01.pdf\nr-02.pdf\nr-03.pdf\n')
        result = self.post('/api/webenum/commands', {'list_id': item['id'], 'target':'http://127.0.0.1:8000',
                                           'directory_wordlist':'/tmp/dirs.txt', 'threads':10})
        self.assertIn(str(Path(self.folder.name) / 'webenum' / (item['id'] + '.txt')), result['files'])
        # Old metadata paths must not leak into commands after transfer to Kali.
        meta = Path(self.folder.name) / 'webenum' / (item['id'] + '.json')
        old = json.loads(meta.read_text())
        old['path'] = 'C:/old/location/list.txt'
        meta.write_text(json.dumps(old))
        result = self.post('/api/webenum/commands', {'list_id': item['id'], 'target':'http://127.0.0.1:8000',
                                           'directory_wordlist':'/tmp/dirs.txt', 'threads':10})
        self.assertNotIn('C:/old', result['files'])

    def test_request_guards(self):
        for token, origin in [(False,None), (True,'http://foreign.example')]:
            with self.assertRaises(HTTPError) as caught:
                self.post('/api/webenum/generate', {'mask':'a.pdf'}, token, origin)
            self.assertEqual(caught.exception.code, 403)
        with self.assertRaises(HTTPError) as caught:
            self.post('/api/webenum/commands', {'list_id':'../../etc/passwd'})
        self.assertEqual(caught.exception.code, 400)

    def test_catalogue_and_module_assets(self):
        with urlopen(self.base + '/api/modules') as response:
            modules = json.load(response)
        self.assertEqual(modules[0]['slug'], 'webenum')
        for route, expected in [('/', b'Web Enumeration Prep'), ('/tools/webenum/', b'Web Enumeration Prep'),
                                ('/tools/webenum/app.js', b'/api/webenum/'),
                                ('/assets/t47-v2/styles.css', b'tokens/colors.css')]:
            with self.subTest(route=route), urlopen(self.base + route) as response:
                self.assertIn(expected, response.read())

    def test_module_static_path_cannot_escape_web_root(self):
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.base + '/tools/webenum/../../../app.py')
        self.assertEqual(caught.exception.code, 404)


if __name__ == '__main__':
    unittest.main()
