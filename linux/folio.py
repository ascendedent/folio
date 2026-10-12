#!/usr/bin/env python3
"""Folio as a desktop window. The studio is bundled beside this file."""

import mimetypes
import os
from pathlib import Path

# WebKit's DMA-BUF path hits a Wayland protocol error on this KDE session.
os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")

import json
import os

import gi

gi.require_version("GLib", "2.0")
gi.require_version("JavaScriptCore", "4.1")
from gi.repository import GLib, JavaScriptCore

# KDE matches the running window to a desktop file by this name.
# The script name folio.py does not match folio.desktop, so the taskbar
# draws a letter instead of the Folio mark.
GLib.set_prgname("folio")
GLib.set_application_name("Folio")

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gio, Gtk, WebKit2

ROOT = Path(__file__).resolve().parent / "studio"
ICON = Path(__file__).resolve().parent / "favicon.png"
APP_ID = "com.joemarotta.folio"
LAST_OPEN = Path(__file__).resolve().parent / "last-open.json"
EXPORT_FOLDERS = Path(__file__).resolve().parent / "export-folders.json"


def mime_for(path: Path) -> str:
    guessed, _encoding = mimetypes.guess_type(path.name)
    if guessed:
        return guessed
    if path.suffix == ".js":
        return "text/javascript"
    if path.suffix == ".css":
        return "text/css"
    if path.suffix == ".ttf":
        return "font/ttf"
    if path.suffix == ".woff2":
        return "font/woff2"
    return "application/octet-stream"


def studio_file(uri_path: str) -> Path | None:
    if not uri_path or uri_path == "/":
        uri_path = "/index.html"
    if ".." in uri_path.split("/"):
        return None
    target = (ROOT / uri_path.lstrip("/")).resolve()
    try:
        target.relative_to(ROOT.resolve())
    except ValueError:
        return None
    if target.is_file():
        return target
    return None


def spelling_languages() -> list[str]:
    wanted = []
    for name in GLib.get_language_names():
        if name == "C" or "." in name or "@" in name or "_" not in name:
            continue
        if name not in wanted:
            wanted.append(name)
    if "en_US" not in wanted:
        wanted.append("en_US")
    return wanted


def on_scheme(request: WebKit2.URISchemeRequest, _data=None) -> None:
    path = studio_file(request.get_path() or "/")
    if path is None:
        request.finish_error(GLib.Error(f"Not found: {request.get_uri()}"))
        return
    data = path.read_bytes()
    stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(data))
    request.finish(stream, len(data), mime_for(path))


class Folio(Gtk.Application):
    def __init__(self) -> None:
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.window: Gtk.ApplicationWindow | None = None

    def do_activate(self) -> None:
        if self.window is not None:
            self.window.present()
            return
        context = WebKit2.WebContext()
        context.register_uri_scheme("folio", on_scheme)
        context.connect("download-started", self.on_download)
        # Underline misspelled words and list suggestions in the right-click menu.
        context.set_spell_checking_enabled(True)
        context.set_spell_checking_languages(spelling_languages())
        web = WebKit2.WebView.new_with_context(context)
        settings = web.get_settings()
        settings.set_enable_write_console_messages_to_stdout(True)
        settings.set_enable_javascript(True)
        content = web.get_user_content_manager()
        content.connect("script-message-with-reply-received::folio", self.on_script_message)
        content.register_script_message_handler_with_reply("folio", None)
        web.load_uri("folio://studio/index.html")

        window = Gtk.ApplicationWindow(application=self, title="Folio")
        window.set_default_size(1280, 840)
        if ICON.is_file():
            window.set_icon_from_file(str(ICON))
        window.add(web)
        window.show_all()
        self.window = window
        web.connect("load-changed", self.keep_icon)

    def keep_icon(self, _web, event) -> None:
        if event != WebKit2.LoadEvent.FINISHED or self.window is None or not ICON.is_file():
            return
        self.window.set_icon_from_file(str(ICON))

    def on_script_message(self, _manager, value, reply) -> bool:
        # The page is waiting on this reply. The value is already a JavaScript object.
        reply.ref()
        try:
            data = json.loads(value.to_json(0) or "{}")
            context = value.get_context()
        except Exception as exc:
            reply.return_error_message(str(exc))
            reply.unref()
            return True

        def finish() -> bool:
            try:
                answer = self.handle_file_request(data if isinstance(data, dict) else {})
                reply.return_value(JavaScriptCore.Value.new_from_json(context, json.dumps(answer)))
            except Exception as exc:
                reply.return_error_message(str(exc))
            finally:
                reply.unref()
            return False

        GLib.idle_add(finish)
        return True

    def choose_path(self, title: str, action: Gtk.FileChooserAction, suggested: str = "", folder: str = "") -> Path | None:
        window = self.window
        if window is None:
            return None
        dialog = Gtk.FileChooserDialog(title=title, parent=window, action=action)
        dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
        dialog.add_button("Choose" if action == Gtk.FileChooserAction.SELECT_FOLDER else "Open" if action == Gtk.FileChooserAction.OPEN else "Save", Gtk.ResponseType.ACCEPT)
        if suggested and action == Gtk.FileChooserAction.SAVE:
            dialog.set_current_name(suggested)
        start = Path(folder) if folder else Path.home() / "Documents"
        if start.is_file():
            start = start.parent
        if start.is_dir():
            dialog.set_current_folder(str(start))
        response = dialog.run()
        chosen = None
        if response == Gtk.ResponseType.ACCEPT:
            picked = dialog.get_filename()
            if picked:
                chosen = Path(picked)
        dialog.destroy()
        return chosen

    def handle_file_request(self, data: dict) -> dict:
        action = str(data.get("action") or "")
        folder = str(data.get("folder") or "")
        if action == "choose-folder":
            path = self.choose_path("Folder for new scripts", Gtk.FileChooserAction.SELECT_FOLDER, folder=folder)
            if path is None:
                return {"ok": False}
            return {"ok": True, "path": str(path), "name": path.name}
        if action == "last-open":
            try:
                data = json.loads(LAST_OPEN.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return {"ok": False}
            path = Path(str(data.get("path") or ""))
            if not path.is_file():
                return {"ok": False}
            return {"ok": True, "name": path.name, "path": str(path)}
        if action == "open-path":
            path = Path(str(data.get("path") or ""))
            if not path.is_file():
                return {"ok": False, "missing": True}
            remember_open(path)
            return {"ok": True, "name": path.name, "path": str(path), "text": path.read_text(encoding="utf-8")}
        if action == "open":
            start = folder
            if not start:
                try:
                    saved = json.loads(LAST_OPEN.read_text(encoding="utf-8"))
                    parent = Path(str(saved.get("path") or "")).parent
                    if parent.is_dir():
                        start = str(parent)
                except (OSError, json.JSONDecodeError):
                    start = ""
            path = self.choose_path("Open a screenplay", Gtk.FileChooserAction.OPEN, folder=start)
            if path is None:
                return {"ok": False}
            remember_open(path)
            return {"ok": True, "name": path.name, "path": str(path), "text": path.read_text(encoding="utf-8")}
        if action in {"save", "save-as"}:
            name = str(data.get("name") or "Untitled.fdx")
            path_text = "" if action == "save-as" else str(data.get("path") or "")
            target = Path(path_text) if path_text else None
            if action == "save" and (target is None or not target.parent.is_dir()):
                target = last_opened(name) or locate_script(name, folder)
            if target is not None and target.parent.is_dir():
                remember_open(target)
                target.write_text(str(data.get("xml") or ""), encoding="utf-8")
                return {"ok": True, "name": target.name, "path": str(target)}
            start = str(target.parent) if target is not None else folder
            target = self.choose_path(
                "Save screenplay",
                Gtk.FileChooserAction.SAVE,
                name,
                start,
            )
            if target is None:
                return {"ok": False}
            if target.suffix == "":
                target = target.with_suffix(".fdx")
            target.write_text(str(data.get("xml") or ""), encoding="utf-8")
            return {"ok": True, "name": target.name, "path": str(target)}
        return {"ok": False}

    def on_download(self, _context, download: WebKit2.Download) -> None:
        download.connect("decide-destination", self.on_destination)

    def on_destination(self, download: WebKit2.Download, suggested: str) -> bool:
        window = self.window
        if window is None:
            download.cancel()
            return True
        name = suggested or "screenplay.fdx"
        chooser = Gtk.FileChooserNative.new("Save", window, Gtk.FileChooserAction.SAVE, "Save", "Cancel")
        chooser.set_current_name(name)
        chooser.set_current_folder(str(export_folder(name)))
        response = chooser.run()
        if response == Gtk.ResponseType.ACCEPT and chooser.get_uri():
            download.set_allow_overwrite(True)
            download.set_destination(chooser.get_uri())
            picked = chooser.get_filename()
            if picked:
                remember_export(name, Path(picked).parent)
        else:
            download.cancel()
        return True


def remember_open(path: Path) -> None:
    LAST_OPEN.write_text(json.dumps({"name": path.name, "path": str(path)}), encoding="utf-8")


def read_export_folders() -> dict:
    try:
        data = json.loads(EXPORT_FOLDERS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def export_folder(name: str) -> Path:
    """Where this script was last exported, else beside the open script, else the last export folder."""
    data = read_export_folders()
    scripts = data.get("scripts") if isinstance(data.get("scripts"), dict) else {}
    stem = Path(name).stem.lower()
    candidates = [scripts.get(stem)]
    try:
        opened = Path(str(json.loads(LAST_OPEN.read_text(encoding="utf-8")).get("path") or ""))
        if opened.stem.lower() == stem:
            candidates.append(str(opened.parent))
    except (OSError, json.JSONDecodeError):
        pass
    candidates += [data.get("last"), str(Path.home() / "Downloads"), str(Path.home())]
    for candidate in candidates:
        if candidate and Path(str(candidate)).is_dir():
            return Path(str(candidate))
    return Path.home()


def remember_export(name: str, folder: Path) -> None:
    data = read_export_folders()
    scripts = data.get("scripts") if isinstance(data.get("scripts"), dict) else {}
    scripts[Path(name).stem.lower()] = str(folder)
    data["scripts"] = scripts
    data["last"] = str(folder)
    try:
        EXPORT_FOLDERS.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except OSError:
        pass


def last_opened(name: str) -> Path | None:
    try:
        data = json.loads(LAST_OPEN.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if data.get("name") != name:
        return None
    path = Path(str(data.get("path") or ""))
    return path if path.parent.is_dir() else None


def locate_script(name: str, folder: str) -> Path | None:
    """Find this filename under the save folder or the screenplay documents tree."""
    roots: list[str] = []
    for candidate in (
        folder,
        "/mnt/userfiles/Documents/Screenplays",
        str(Path.home() / "Documents"),
        "/mnt/userfiles/Documents",
    ):
        if candidate and candidate not in roots:
            roots.append(candidate)
    skip = {"node_modules", "env", "venv", ".git", "__pycache__", "site-packages", "Lib", "dist"}
    for root in roots:
        base = Path(root)
        if not base.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [item for item in dirnames if item not in skip and not item.startswith(".")]
            if name in filenames:
                return Path(dirpath) / name
    return None


def main() -> None:
    if not (ROOT / "index.html").is_file():
        raise SystemExit(f"Folio studio is missing at {ROOT}")
    Folio().run(None)


if __name__ == "__main__":
    main()
