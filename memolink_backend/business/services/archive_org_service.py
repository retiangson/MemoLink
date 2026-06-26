"""Internet Archive metadata + download client.

Public API docs: https://archive.org/services/docs/api/metadata.html

One call to /metadata/{identifier} returns ALL files for an item with no
pagination and no authentication.  Files covered by Controlled Digital
Lending (access-restricted-item == "true") are rejected at sync time so
the user never sees items they cannot freely download.
"""
from __future__ import annotations

import logging
import mimetypes
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Extensions MemoLink readers can handle (mirrors onedrive_service SUPPORTED_EXTENSIONS)
_SUPPORTED = {
    ".pdf", ".epub", ".mobi", ".txt",
    ".pptx",
    ".mp3", ".m4a", ".m4b", ".aac", ".wav", ".ogg",
    ".srt", ".vtt",
    ".cbz", ".cbr",
    ".mp4", ".webm", ".mov", ".m4v",
}

# archive.org-internal metadata/derivative formats that are not real content
_SKIP_FORMATS = {
    "Metadata", "Archive BitTorrent", "Internet Archive HTML5 Uploader",
    "Item Tile", "Item Image", "JPEG Thumb", "Thumbnail", "Dublin Core",
    "Scandata", "Unknown", "Text PDF", "Grayscale LuraTech PDF",
    "Single Page Processed JP2 ZIP", "Animated GIF",
}

_EXT_MIME: dict[str, str] = {
    ".pdf":  "application/pdf",
    ".epub": "application/epub+zip",
    ".mobi": "application/x-mobipocket-ebook",
    ".txt":  "text/plain",
    ".cbz":  "application/zip",
    ".cbr":  "application/x-rar-compressed",
    ".mp3":  "audio/mpeg",
    ".m4a":  "audio/mp4",
    ".m4b":  "audio/mp4",
    ".aac":  "audio/aac",
    ".wav":  "audio/wav",
    ".ogg":  "audio/ogg",
    ".mp4":  "video/mp4",
    ".webm": "video/webm",
    ".mov":  "video/quicktime",
    ".m4v":  "video/mp4",
    ".srt":  "text/plain",
    ".vtt":  "text/vtt",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


class ArchiveOrgServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class ArchiveOrgService:
    _META_URL = "https://archive.org/metadata/{identifier}"
    _DL_URL   = "https://archive.org/download/{identifier}/{filename}"

    # ── Public API ────────────────────────────────────────────────────────────

    async def list_item_files(self, identifier: str) -> tuple[list[dict], str]:
        """Return (files, source_location) for a public archive.org item.

        Each file dict has the same shape that BookSyncService / OneDrive sync
        produces: item_id, drive_id, name, extension, mime_type, size,
        web_url, last_modified.

        Raises ArchiveOrgServiceError when:
        - The item does not exist (404)
        - The item is access-restricted / CDL-only (403)
        - archive.org is unreachable (503)
        """
        data = await self._fetch_metadata(identifier)
        meta = data.get("metadata", {})

        if str(meta.get("access-restricted-item", "")).lower() == "true":
            raise ArchiveOrgServiceError(
                403,
                f"'{identifier}' is an access-restricted item (Controlled Digital Lending). "
                "Only freely downloadable items are supported — choose a different identifier.",
            )

        source_location = f"Internet Archive · {identifier}"
        files = self._parse_files(data.get("files", []), identifier)
        return files, source_location

    async def download_file_bytes(self, identifier: str, filename: str) -> bytes:
        """Download a single file from archive.org. No auth required."""
        url = self._DL_URL.format(identifier=identifier, filename=filename)
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=600) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    raise ArchiveOrgServiceError(
                        resp.status_code,
                        f"archive.org download returned HTTP {resp.status_code} for {identifier}/{filename}.",
                    )
                return resp.content
        except httpx.RequestError as exc:
            raise ArchiveOrgServiceError(503, f"Download from archive.org failed: {exc}")

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def _fetch_metadata(self, identifier: str) -> dict:
        url = self._META_URL.format(identifier=identifier)
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
                resp = await client.get(url)
                if resp.status_code == 404:
                    raise ArchiveOrgServiceError(404, f"Archive.org item '{identifier}' not found.")
                if resp.status_code != 200:
                    raise ArchiveOrgServiceError(
                        resp.status_code,
                        f"Archive.org returned HTTP {resp.status_code} for '{identifier}'.",
                    )
                return resp.json()
        except httpx.RequestError as exc:
            raise ArchiveOrgServiceError(503, f"Could not reach archive.org: {exc}")

    def _parse_files(self, files_raw: list[dict], identifier: str) -> list[dict]:
        out: list[dict] = []
        for f in files_raw:
            name: str = (f.get("name") or "").strip()
            if not name:
                continue

            if f.get("format", "") in _SKIP_FORMATS:
                continue

            dot = name.rfind(".")
            ext = name[dot:].lower() if dot != -1 else ""
            if ext not in _SUPPORTED:
                continue

            size = 0
            for size_key in ("size", "length"):
                try:
                    size = int(f.get(size_key) or 0)
                    break
                except (ValueError, TypeError):
                    pass

            last_modified: Optional[str] = None
            for ts_key in ("mtime", "ctime"):
                raw_ts = f.get(ts_key) or ""
                if raw_ts:
                    try:
                        last_modified = datetime.fromtimestamp(
                            int(raw_ts), tz=timezone.utc
                        ).isoformat()
                        break
                    except (ValueError, TypeError):
                        pass

            mime = _EXT_MIME.get(ext, mimetypes.guess_type(name)[0] or "application/octet-stream")
            # archive.org files can be nested in subdirs (e.g. "SubDir/Title.cbz").
            # Keep the full path for the download URL and item_id (uniqueness), but
            # store only the base filename so title/file_name columns stay short.
            base_name = name.split("/")[-1]
            web_url = self._DL_URL.format(identifier=identifier, filename=name)

            out.append({
                "item_id": f"archiveorg:{identifier}/{name}",
                "drive_id": "archiveorg",
                "name": base_name,
                "extension": ext,
                "mime_type": mime,
                "size": size,
                "web_url": web_url,
                "last_modified": last_modified,
            })
        return out
