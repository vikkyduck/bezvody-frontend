"""Наблюдатель: контрольная копия из ветки, отправка адресатам только после слияния того же письма."""
import datetime as dt
import importlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PERIOD = "17.11-23.11.26"
TODAY = dt.date(2026, 11, 24)

FAKE_GATEWAY = '''#!/usr/bin/env python3
import os, sys, hashlib, json
state = os.environ["RADAR_STATE"]; data = sys.stdin.buffer.read()
action, period = os.environ["SSH_ORIGINAL_COMMAND"].split()
open(os.path.join(state, "calls.log"), "a").write(action + " " + hashlib.sha256(data).hexdigest()[:8] + "\\n")
if action == "send": open(os.path.join(state, period + ".sent"), "w").write("x")
print("ok")
'''


def sh(cwd, *args):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"})


class WatchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.origin = self.tmp / "origin"; self.origin.mkdir()
        sh(self.origin, "git", "init", "-q", "-b", "main")
        (self.origin / "README.md").write_text("site")
        sh(self.origin, "git", "add", "-A"); sh(self.origin, "git", "commit", "-qm", "init")
        gateway = self.tmp / "gateway"; gateway.write_text(FAKE_GATEWAY); gateway.chmod(0o755)
        os.environ.update(RADAR_REPO=str(self.tmp / "clone"), RADAR_STATE=str(self.tmp / "state"),
                          RADAR_GATEWAY=str(gateway), RADAR_REMOTE=str(self.origin))
        sys.path.insert(0, str(ROOT / "deploy"))
        import radar_watch
        self.watch = importlib.reload(radar_watch)
        (self.tmp / "state").mkdir()

    def put(self, branch, subject, period=PERIOD):
        sh(self.origin, "git", "checkout", "-q", "-B", branch)
        folder = self.origin / "radar" / "issues" / period; folder.mkdir(parents=True, exist_ok=True)
        (folder / "page.html").write_text("<!doctype html>page " + subject)
        (folder / "mail.json").write_text(json.dumps({"period": period, "subject": subject, "html": "h", "text": "t"}))
        sh(self.origin, "git", "add", "-A"); sh(self.origin, "git", "commit", "-qm", subject)

    def merge(self, branch):
        sh(self.origin, "git", "checkout", "-q", "main"); sh(self.origin, "git", "merge", "-q", "--no-ff", "-m", "merge", branch)

    def tick(self):
        self.watch.fetch(); self.watch.step(TODAY)
        log = self.tmp / "state" / "calls.log"
        return [line.split()[0] for line in log.read_text().splitlines()] if log.exists() else []

    def test_draft_gets_one_control_copy_and_merge_sends_once(self):
        self.put("radar-issue/" + PERIOD, "Тема")
        self.assertEqual(self.tick(), ["publish", "test"])
        self.assertEqual(self.tick(), ["publish", "test"])  # без правок вторая копия не уходит
        self.put("radar-issue/" + PERIOD, "Тема после правки")
        self.assertEqual(self.tick(), ["publish", "test", "publish", "test"])
        self.merge("radar-issue/" + PERIOD)
        self.assertEqual(self.tick()[-1], "send")
        self.assertEqual(self.tick().count("send"), 1)  # второй раз не отправляется

    def test_letter_that_was_not_shown_is_never_sent(self):
        # Выпуск попал в main мимо ветки или изменился при слиянии: адресатам не уходит, уходит контрольная копия.
        self.put("radar-issue/" + PERIOD, "Тема")
        self.tick()
        sh(self.origin, "git", "checkout", "-q", "main")
        self.put("main", "Другое письмо")
        calls = self.tick()
        self.assertNotIn("send", calls)
        self.assertEqual(calls[-2:], ["publish", "test"])
        self.assertNotIn("send", self.tick())
        self.assertEqual(len(self.tick()), len(calls))  # и копия не повторяется

    def test_old_issue_folder_starts_nothing(self):
        self.put("radar-issue/01.09-07.09.26", "Старый выпуск", period="01.09-07.09.26")
        self.merge("radar-issue/01.09-07.09.26")
        self.assertEqual(self.tick(), [])


if __name__ == "__main__":
    unittest.main()
