"""Regression checks for explicit descriptions, feedback corridors and PDF notes."""
import json
import sys
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "assets" / "figures_kit"))
import figures_kit as kit
import render_schematic as renderer

sheet = kit.Sheet(3.45, 2)
assert sheet.wrap_desc("formula\nstage role", 2, 7) == ["formula", "stage role"]
lines = sheet.wrap_desc("one\ntwo\nthree\nfour\nfive", 2, 7)
assert " ".join(lines) == "one two three four five", lines
desc = "many words in the first description segment " * 8 + "\nFINAL-SEGMENT"
assert "FINAL-SEGMENT" in " ".join(sheet.wrap_desc(desc, 1, 7))
kit.plt.close(sheet.fig)

captured = []
class ProbeSheet(kit.Sheet):
    def __init__(self, *args):
        super().__init__(*args)
        captured.append(self)

renderer.Sheet = ProbeSheet
spec = json.loads(sys.argv[2])
spec["outDir"] = sys.argv[1]
spec["name"] = "verify_note_and_feedback"
spec["edges"][-1]["route"] = "around"
spec["swing"] = 0.1
spec["note"] = "A long explanation with explicit evidence and consistent terminology. " * 5
result = renderer.render(spec)
sheet = captured[-1]
feedback = [points for points, endpoints in sheet.edges if endpoints == ("d", "a")]
assert len(feedback) == 1 and len(feedback[0]) == 4, feedback
points = feedback[0]
assert points[1][0] == points[2][0], points
assert points[1][1] != points[2][1], points
notes = [text for text in sheet.ax.texts if "A long explanation" in text.get_text()]
assert len(notes) == 1 and "\n" in notes[0].get_text()
sheet.fig.canvas.draw()
width = notes[0].get_window_extent(sheet.fig.canvas.get_renderer()).width / sheet.fig.dpi
assert width <= sheet.w - 2 * spec["margin"][0] + 0.01, width
with fitz.open(result["pdf"]) as pdf:
    assert pdf[0].rect.width <= sheet.w * 72 + 10, pdf[0].rect
    extracted = " ".join(pdf[0].get_text().split())
    assert extracted.count("consistent terminology.") == 5, extracted
print("Figure layout passed: forced line breaks, no lost description text, single feedback corridor, note width and exported PDF text.")
