# https_server.py
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import ssl
import os

def main():
    # Serve current directory; change to a specific dir if needed
    web_root = os.getcwd()

    class Handler(SimpleHTTPRequestHandler):
        # Optional: pin the directory explicitly
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=web_root, **kwargs)

    server = ThreadingHTTPServer(("0.0.0.0", 443), Handler)

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(certfile="cert.pem", keyfile="key.pem")

    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    print(f"Serving HTTPS on 0.0.0.0:443, dir={web_root}")
    server.serve_forever()

if __name__ == "__main__":
    main()