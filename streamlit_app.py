"""
SVG → HTML5 Banner Engine — Streamlit host
==========================================
Reads index.html and app.js from the same directory, inlines the JS, and
renders the tool inside a Streamlit components.html iframe.

Why inlining is required
------------------------
Streamlit serves components.html inside a sandboxed iframe.  Any relative
path like src="app.js" is resolved against the iframe's srcdoc origin, which
has no access to the host filesystem.  Replacing the <script> tag with the
file's raw content is the standard fix.

All CDN references (Tailwind, JSZip, FileSaver, GSAP) are absolute URLs and
continue to work normally inside the iframe.

Deployment checklist
--------------------
  index.html          ← must live next to this file
  app.js              ← must live next to this file
  streamlit_app.py    ← this file
  requirements.txt    ← add "streamlit" (no other deps needed)
"""

import streamlit as st
import streamlit.components.v1 as components
from pathlib import Path

# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="SVG → HTML5 Banner Engine",
    page_icon="🎯",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Strip all default Streamlit chrome ────────────────────────────────────────
# This gives the embedded tool the full browser viewport with no wasted space.
st.markdown(
    """
    <style>
      /* Top navigation bar */
      header[data-testid="stHeader"]  { display: none !important; }
      /* Hamburger / main menu */
      #MainMenu                        { visibility: hidden; }
      /* "Made with Streamlit" footer */
      footer                           { visibility: hidden; }
      /* Toolbar that sometimes appears top-right */
      [data-testid="stToolbar"]        { display: none !important; }
      /* Remove block-container padding so the iframe fills edge-to-edge */
      .block-container {
        padding: 0 !important;
        max-width: 100% !important;
      }
      /* Ensure the iframe itself has no extra margin or border */
      iframe { display: block !important; border: none !important; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ── Locate source files ───────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
HTML_FILE  = BASE_DIR / "index.html"
JS_FILE    = BASE_DIR / "app.js"

# ── Read files ────────────────────────────────────────────────────────────────
try:
    html = HTML_FILE.read_text(encoding="utf-8")
except FileNotFoundError:
    st.error(f"**index.html not found.**  Expected it at: `{HTML_FILE}`")
    st.stop()

try:
    js = JS_FILE.read_text(encoding="utf-8")
except FileNotFoundError:
    st.error(f"**app.js not found.**  Expected it at: `{JS_FILE}`")
    st.stop()

# ── Inline app.js ─────────────────────────────────────────────────────────────
# Replace the single local <script src="app.js"> tag with the file's content.
SCRIPT_TAG = '<script src="app.js"></script>'

if SCRIPT_TAG not in html:
    st.error(
        "Could not find `<script src=\"app.js\"></script>` in index.html.  "
        "The tag may have been renamed — update `SCRIPT_TAG` in this file to match."
    )
    st.stop()

html = html.replace(SCRIPT_TAG, f"<script>\n{js}\n</script>")

# ── Render ────────────────────────────────────────────────────────────────────
# height=1000  – tall enough to show the full split-screen tool without external
#                scrollbars.  Increase if the controls section gets clipped on
#                your monitor.
# scrolling=False – the tool manages its own internal overflow (overflow:hidden
#                   body + internal flex layout); a Streamlit scrollbar on top
#                   would just add a redundant second scroll context.
components.html(html, height=1000, scrolling=False)
