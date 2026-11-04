"""Synthetic evaluation only; returns offsets in JS UTF-16 units."""
import json
import logging
from pathlib import Path
import socket
import sys
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
logging.disable(logging.CRITICAL)
from vcare_pseudonymizer.detection import Detector
fixtures=json.load(sys.stdin)
with patch.object(socket.socket,'connect',side_effect=AssertionError('Network prohibited')):
    detector=Detector()
    results=[]
    for fixture in fixtures:
        text=fixture['text']
        def offset(index):
            return len(text[:index].encode('utf-16-le'))//2
        spans=[{'start':offset(s.start),'end':offset(s.end),'kind':s.kind,'priority':s.priority} for s in detector.detect(text)]
        results.append({'id':fixture['id'],'spans':spans})
print(json.dumps({'versions':detector.version,'results':results}))
