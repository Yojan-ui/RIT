"""Drive the raw-socket probe against a scripted fake SMTP server on localhost."""

import socket
import threading

from app.collectors.smtp_probe import probe_starttls


def _serve_once(script):
    """Start a one-connection server; `script(conn)` plays the server side."""
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]

    def run():
        conn, _ = listener.accept()
        with conn:
            try:
                script(conn, conn.makefile("rb"))
            except OSError:
                pass
        listener.close()

    threading.Thread(target=run, daemon=True).start()
    return port


def _probe(port):
    return probe_starttls("mx.test", "127.0.0.1", port=port, timeout=2)


def test_server_without_starttls():
    def script(conn, rfile):
        conn.sendall(b"220 mx.test ESMTP\r\n")
        rfile.readline()  # EHLO
        conn.sendall(b"250-mx.test\r\n250-PIPELINING\r\n250 SIZE 1000\r\n")
        rfile.readline()

    result = _probe(_serve_once(script))
    assert result.reachable and result.ehlo_ok
    assert result.banner == "mx.test ESMTP"
    assert not result.starttls_offered
    assert result.error is None


def test_starttls_offered_but_refused():
    def script(conn, rfile):
        conn.sendall(b"220 mx.test ESMTP\r\n")
        rfile.readline()
        conn.sendall(b"250-mx.test\r\n250 STARTTLS\r\n")
        rfile.readline()  # STARTTLS
        conn.sendall(b"454 TLS not available\r\n")

    result = _probe(_serve_once(script))
    assert result.starttls_offered
    assert "454" in result.error


def test_non_220_greeting():
    def script(conn, rfile):
        conn.sendall(b"554 go away\r\n")

    result = _probe(_serve_once(script))
    assert result.reachable and "554" in result.error


def test_injected_plaintext_after_starttls_is_rejected():
    def script(conn, rfile):
        conn.sendall(b"220 mx.test ESMTP\r\n")
        rfile.readline()
        conn.sendall(b"250-mx.test\r\n250 STARTTLS\r\n")
        rfile.readline()
        conn.sendall(b"220 go ahead\r\n250 injected\r\n")

    result = _probe(_serve_once(script))
    assert "unexpected data" in result.error


def test_connection_refused():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]  # closed immediately -> nothing listening
    result = _probe(port)
    assert not result.reachable
    assert result.error


def test_timeout_waiting_for_banner():
    event = threading.Event()

    def script(conn, rfile):
        event.wait(3)

    result = probe_starttls("mx.test", "127.0.0.1", port=_serve_once(script), timeout=0.5)
    event.set()
    assert not result.reachable and "Timed out" in result.error
