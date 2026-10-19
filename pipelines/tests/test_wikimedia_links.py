"""Links from Wikimedia metadata become hrefs on place pages: only http(s) may pass."""

from golaly_catalog.sources.wikimedia import _first_link, _http


def test_http_only():
    assert _http("https://creativecommons.org/licenses/by-sa/4.0") == "https://creativecommons.org/licenses/by-sa/4.0"
    assert _http("//commons.wikimedia.org/wiki/File:X.jpg") == "https://commons.wikimedia.org/wiki/File:X.jpg"
    for bad in ["javascript:alert(1)", "data:text/html,<b>x</b>", "  vbscript:x", "", None, "ftp://x"]:
        assert _http(bad) is None


def test_first_link_ignores_non_http():
    assert _first_link('<a href="javascript:alert(1)">me</a>') is None
    assert _first_link('<a href="//commons.wikimedia.org/wiki/User:Me">me</a>') == "https://commons.wikimedia.org/wiki/User:Me"
