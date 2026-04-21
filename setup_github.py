"""
setup_github.py — Despliega The Juanmo Times en GitHub Pages.

Ejecutar UNA SOLA VEZ:
    python setup_github.py

Requiere un Personal Access Token de GitHub con permisos: repo, workflow
"""

import os
import sys
import json
import base64
import subprocess
import urllib.request
import urllib.error

OWNER = "juanmopeirano"
REPO  = "juanmo-times"
API   = "https://api.github.com"

FILES = [
    "index.html",
    "manifest.json",
    "icon.svg",
    "sw.js",
    "news.json",
    "fetch_news.py",
    ".github/workflows/update.yml",
]

def api(method, path, token, data=None):
    url = f"{API}{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"GitHub API {e.code}: {body}")

def read_file(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()

def main():
    print("=" * 50)
    print("  The Juanmo Times — Setup GitHub")
    print("=" * 50)
    print()
    print("Necesitás un Personal Access Token de GitHub.")
    print("Cómo crearlo:")
    print("  1. Ir a github.com → tu foto → Settings")
    print("  2. Developer settings → Personal access tokens → Tokens (classic)")
    print("  3. Generate new token (classic)")
    print("  4. Tildar: repo  y  workflow")
    print("  5. Copiar el token y pegarlo acá abajo")
    print()

    token = input("Token: ").strip()
    if not token:
        print("Token vacío. Saliendo.")
        sys.exit(1)

    # 1. Crear repo
    print("\n[1/4] Creando repositorio...")
    try:
        api("POST", "/user/repos", token, {
            "name": REPO,
            "description": "The Juanmo Times — mi resumen diario de noticias",
            "private": False,
            "auto_init": False,
        })
        print(f"      Repo creado: github.com/{OWNER}/{REPO}")
    except RuntimeError as e:
        if "already exists" in str(e) or "name already exists" in str(e):
            print("      El repo ya existe, continuando...")
        else:
            raise

    # 2. Generar news.json fresco
    print("\n[2/4] Generando noticias iniciales...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "feedparser", "-q"], check=True)
        subprocess.run([sys.executable, "fetch_news.py"], check=True)
    except Exception as e:
        print(f"      Advertencia: no se pudo generar news.json ({e})")
        print("      Se usará el archivo vacío, las noticias llegarán en la primera ejecución automática.")

    # 3. Subir archivos
    print("\n[3/4] Subiendo archivos...")
    for filepath in FILES:
        if not os.path.exists(filepath):
            print(f"      [!] No encontrado: {filepath}, saltando...")
            continue
        content = read_file(filepath)
        try:
            # Intentar obtener SHA si ya existe
            info = api("GET", f"/repos/{OWNER}/{REPO}/contents/{filepath}", token)
            sha = info.get("sha")
        except RuntimeError:
            sha = None

        payload = {
            "message": f"add: {filepath}",
            "content": content,
        }
        if sha:
            payload["sha"] = sha

        api("PUT", f"/repos/{OWNER}/{REPO}/contents/{filepath}", token, payload)
        print(f"      ✓ {filepath}")

    # 4. Activar GitHub Pages
    print("\n[4/4] Activando GitHub Pages...")
    try:
        api("POST", f"/repos/{OWNER}/{REPO}/pages", token, {
            "source": {"branch": "main", "path": "/"}
        })
        print("      GitHub Pages activado.")
    except RuntimeError as e:
        if "already enabled" in str(e) or "409" in str(e):
            print("      GitHub Pages ya estaba activo.")
        else:
            print(f"      Advertencia: {e}")
            print("      Activá Pages manualmente: Settings → Pages → Branch: main → / (root)")

    print()
    print("=" * 50)
    print("  ¡LISTO!")
    print()
    print(f"  Tu app: https://{OWNER}.github.io/{REPO}/")
    print()
    print("  Las noticias se actualizan automáticamente")
    print("  a las 7am, 1pm y 7pm (hora Uruguay).")
    print()
    print("  Compartí el link por WhatsApp y tus amigos")
    print("  pueden instalarlo en el celu como una app.")
    print("=" * 50)

if __name__ == "__main__":
    main()
