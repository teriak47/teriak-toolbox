"""Execute the real generated SQL against fictional Viewer-shaped tables."""
import json
import subprocess
import unittest
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = r"""
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/<script id="generator">([\s\S]*?)<\/script>/);
if (!match) throw new Error('Generator script not found');
const context = vm.createContext({});
vm.runInContext(match[1], context);
const defaults = {mode:'shares',machine:'',rule:'',match:'exact',level:'',guid:'',ip:'',channel:'',eventId:'',recordId:'',after:'',before:'',limit:'50',order:'time'};
const configs = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(configs.map(c => context.ZircoSQL.build({...defaults,...c}))));
"""


def generate(configs):
    result = subprocess.run(
        ["node", "-e", GENERATOR], cwd=ROOT, input=json.dumps(configs),
        text=True, capture_output=True, check=True,
    )
    return json.loads(result.stdout)


class DuckDBQueryTests(unittest.TestCase):
    def setUp(self):
        self.db = duckdb.connect(":memory:")
        self.addCleanup(self.db.close)
        fields = [
            "Computer", "Channel", "EventID", "EventRecordID", "OriginalLogfile",
            "SubjectDomainName", "SubjectUserName", "IpAddress", "ShareName", "RelativeTargetName",
            "Image", "CommandLine", "ProcessGuid", "ProcessId", "ParentImage", "ParentCommandLine",
            "ParentProcessGuid", "User", "TargetFileName", "Initiated", "SourceIp", "SourcePort",
            "DestinationIp", "DestinationPort", "QueryName", "TargetDomainName", "TargetUserName",
            "LogonType", "TargetLogonId",
        ]
        self.db.execute('CREATE TABLE events (_zl_uid BIGINT, _zl_time TIMESTAMP, ' +
                        ', '.join('"' + field + '" VARCHAR' for field in fields) + ')')
        self.db.execute('CREATE TABLE rules (rule_idx INTEGER, title VARCHAR, level VARCHAR)')
        self.db.execute('CREATE TABLE hits (_zl_uid BIGINT, rule_idx INTEGER)')
        guid = '{12345678-1234-1234-1234-123456789abc}'
        sysmon = 'Microsoft-Windows-Sysmon/Operational'
        rows = [
            (1, 'Security', '5145', {'SubjectUserName': 'alice', 'IpAddress': '192.0.2.1', 'ShareName': 'share', 'RelativeTargetName': 'a.txt'}),
            (2, 'Security', '4624', {'IpAddress': '192.0.2.1'}),
            (3, 'Security', '4625', {'IpAddress': '192.0.2.2'}),
            (4, sysmon, '1', {'ProcessGuid': guid}),
            (5, sysmon, '1', {'ParentProcessGuid': guid}),
            (6, sysmon, '11', {'ProcessGuid': guid, 'TargetFileName': 'out.txt'}),
            (7, sysmon, '3', {'ProcessGuid': guid, 'DestinationIp': '192.0.2.3'}),
            (8, sysmon, '22', {'ProcessGuid': guid, 'QueryName': 'example.test'}),
        ]
        for uid, channel, event_id, extra in rows:
            values = {'_zl_uid': uid, '_zl_time': f'2024-01-01 00:00:0{uid}', 'Computer': 'host',
                      'Channel': channel, 'EventID': event_id, 'EventRecordID': str(uid), **extra}
            columns = ', '.join('"' + key + '"' for key in values)
            placeholders = ', '.join('?' for _ in values)
            self.db.execute(f'INSERT INTO events ({columns}) VALUES ({placeholders})', list(values.values()))
        self.db.execute("INSERT INTO rules VALUES (1, 'Example rule', 'high')")
        self.db.execute('INSERT INTO hits VALUES (1, 1), (2, 1)')

    def test_all_templates_execute_and_select_expected_events(self):
        guid = '{12345678-1234-1234-1234-123456789abc}'
        scenarios = [
            ({'mode': 'ruleEvents', 'rule': 'Example rule'}, [1, 2]),
            ({'mode': 'start', 'guid': guid}, [4]), ({'mode': 'children', 'guid': guid}, [5]),
            ({'mode': 'files', 'guid': guid}, [6]), ({'mode': 'network', 'guid': guid}, [7, 8]),
            ({'mode': 'logons'}, [2, 3]),
            ({'mode': 'event', 'machine': 'host', 'channel': 'Security', 'eventId': '4624', 'recordId': '2'}, [2]),
        ]
        for (config, expected), sql in zip(scenarios, generate([c for c, _ in scenarios])):
            with self.subTest(mode=config['mode']):
                self.assertEqual([row[0] for row in self.db.execute(sql).fetchall()], expected)
        shares, rules = generate([{'mode': 'shares'}, {'mode': 'rules'}])
        self.assertEqual(self.db.execute(shares).fetchone()[5:7], (1, 1))
        self.assertEqual(self.db.execute(rules).fetchone()[:4], ('Example rule', 'high', 'host', 2))

    def test_time_window_and_row_limit(self):
        sql = generate([{'mode': 'logons', 'after': '2024-01-01T00:00:02',
                         'before': '2024-01-01T00:00:03', 'limit': '1'}])[0]
        self.assertEqual([row[0] for row in self.db.execute(sql).fetchall()], [2])

    def test_rule_search_treats_quotes_and_wildcards_as_literals(self):
        self.db.execute('INSERT INTO rules VALUES (?, ?, ?)', [2, "rule's !%_ exact", 'medium'])
        self.db.execute('INSERT INTO rules VALUES (?, ?, ?)', [3, "rule's !ZZ exact", 'medium'])
        self.db.execute('INSERT INTO hits VALUES (3, 2), (4, 3)')
        sql = generate([{'mode': 'ruleEvents', 'rule': "rule's !%_", 'match': 'contains'}])[0]
        self.assertEqual([row[0] for row in self.db.execute(sql).fetchall()], [3])


if __name__ == '__main__':
    unittest.main()
