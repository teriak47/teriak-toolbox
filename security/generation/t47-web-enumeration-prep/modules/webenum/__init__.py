"""Web enumeration preparation module; no scanner execution."""
import json
from pathlib import Path
import threading
import uuid
from .core import InputError, estimate, make_commands, write_list


class WebEnum:
    slug = 'webenum'
    title = 'Web enumeration'
    description = 'Generate filename wordlists and prepare Gobuster or ffuf commands.'
    cote = 'T47/OUTIL/01'
    web_root = Path(__file__).resolve().parent / 'web'

    def __init__(self, data_root):
        self.data_dir = (data_root / self.slug).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    def metadata(self, item_id):
        if not isinstance(item_id, str) or len(item_id) != 32 or any(c not in '0123456789abcdef' for c in item_id):
            raise InputError('Invalid list identifier.')
        path = self.data_dir / (item_id + '.json')
        if not path.exists():
            raise InputError('List not found. Generate a list before preparing a command.')
        return json.loads(path.read_text(encoding='utf-8'))

    def get(self, action):
        if action == 'lists':
            items = [json.loads(p.read_text(encoding='utf-8')) for p in self.data_dir.glob('*.json')]
            return sorted(items, key=lambda item: item['id'], reverse=True)
        raise InputError('Unknown action.')

    def download(self, item_id):
        item = self.metadata(item_id)
        return self.data_dir / (item['id'] + '.txt'), 'wordlist-' + item['id'][:8] + '.txt'

    def post(self, action, data):
        if action == 'estimate':
            return estimate(data.get('mask'))
        if action == 'commands':
            item = self.metadata(data.get('list_id'))
            return make_commands(data.get('target'), str(self.data_dir / (item['id'] + '.txt')),
                                 data.get('directory_wordlist'), data.get('threads'))
        if action != 'generate':
            raise InputError('Unknown action.')
        if not self.lock.acquire(blocking=False):
            raise InputError('A generation is already in progress.')
        item_id = uuid.uuid4().hex
        path = self.data_dir / (item_id + '.txt')
        try:
            result = write_list(data.get('mask'), path)
            result.update({'id': item_id, 'mask': data['mask'], 'path': str(path)})
            (self.data_dir / (item_id + '.json')).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
            return result
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            self.lock.release()
