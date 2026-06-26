from __future__ import annotations

import base64
import hashlib
import hmac
import tempfile
import time
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from memolink_backend.core.config import settings
from memolink_backend.domain.models.book import Book
from memolink_backend.business.services.onedrive_service import OneDriveService

# Presigned GET URLs are short-lived on purpose: long enough for a slow connection
# to finish downloading, short enough to limit how long a leaked URL stays usable.
_PRESIGNED_URL_TTL_SECONDS = 900

# Local dev cache lives under the OS temp directory; it's cleared on reboot and
# does not persist across server restarts, which is intentional — no stale files.
_LOCAL_CACHE_ROOT = Path(tempfile.gettempdir()) / "ml-book-cache"


class BookCacheServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class BookCacheService:
    """Caches OneDrive book files and serves them via short-lived signed URLs.

    Production path (S3_UPLOAD_BUCKET set):
        Downloads → S3 cache → presigned S3 GET URL returned to client.
        Streaming through the backend breaks on Lambda (6 MB response cap), so
        the client always fetches the file directly from S3 instead.

    Local dev path (S3_UPLOAD_BUCKET empty):
        Downloads → local temp-dir cache → HMAC-signed URL pointing to the
        /local-stream backend endpoint, which streams the file directly.
        The signed URL mirrors the presigned-URL pattern so the frontend code
        requires no changes between dev and prod.
    """

    def __init__(self, onedrive_service: OneDriveService):
        self._onedrive = onedrive_service

    # ── S3 helpers ────────────────────────────────────────────────────────────

    def _s3(self):
        # A new client is created on each call — Lambda may rotate credentials,
        # so caching across invocations is intentionally avoided.
        kwargs = {
            "region_name": settings.aws_region,
            "config": Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
        }
        if settings.aws_access_key_id and settings.aws_secret_access_key:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
            if settings.aws_session_token:
                kwargs["aws_session_token"] = settings.aws_session_token
        return boto3.client("s3", **kwargs)

    def _cache_key(self, book: Book) -> str:
        # Folding OneDrive item id + last-modified + size into the key means a
        # re-uploaded/edited OneDrive file naturally gets a new key (cache miss)
        # instead of needing an explicit invalidation step.
        signature = f"{book.onedrive_item_id}|{book.last_modified.isoformat() if book.last_modified else ''}|{book.file_size or ''}"
        signature_hash = hashlib.sha256(signature.encode()).hexdigest()[:16]
        return f"book-cache/{book.id}/{signature_hash}/{book.file_name}"

    # ── Local dev cache helpers ───────────────────────────────────────────────

    def _sig_hash(self, book: Book) -> str:
        """16-char content fingerprint — same hash used in both S3 key and local path."""
        sig = f"{book.onedrive_item_id}|{book.last_modified.isoformat() if book.last_modified else ''}|{book.file_size or ''}"
        return hashlib.sha256(sig.encode()).hexdigest()[:16]

    def _local_path(self, book: Book) -> Path:
        return _LOCAL_CACHE_ROOT / str(book.id) / self._sig_hash(book) / (book.file_name or "book")

    def _make_local_token(self, user_id: int, book_id: int, sig_hash: str, time_bucket: int) -> str:
        msg = f"{user_id}:{book_id}:{sig_hash}:{time_bucket}".encode()
        digest = hmac.new(settings.jwt_secret_key.encode(), msg, "sha256").digest()
        return base64.urlsafe_b64encode(digest).decode().rstrip("=")

    def local_token(self, user_id: int, book_id: int, sig_hash: str) -> str:
        return self._make_local_token(user_id, book_id, sig_hash, int(time.time()) // 900)

    def verify_local_token(self, user_id: int, book_id: int, sig_hash: str, tok: str) -> bool:
        """Accept tokens from the current and previous 15-minute window (≤ 30 min validity)."""
        bucket = int(time.time()) // 900
        for offset in (0, -1):
            expected = self._make_local_token(user_id, book_id, sig_hash, bucket + offset)
            if hmac.compare_digest(tok, expected):
                return True
        return False

    def local_file(self, book_id: int, sig_hash: str) -> Path | None:
        """Return the cached local path if it exists, or None."""
        candidates = list((_LOCAL_CACHE_ROOT / str(book_id) / sig_hash).glob("*")) if \
            (_LOCAL_CACHE_ROOT / str(book_id) / sig_hash).exists() else []
        return candidates[0] if candidates else None

    # ── Public API ────────────────────────────────────────────────────────────

    async def get_read_url(
        self,
        book: Book,
        *,
        mime_type: str,
        user_id: int = 0,
        base_url: str = "",
    ) -> dict:
        """Return ``{ url, expires_in, cache_hit }`` for the book file.

        Selects S3 (production) or local-stream (dev) automatically based on
        whether ``S3_UPLOAD_BUCKET`` is configured.
        """
        if not settings.s3_upload_bucket:
            return await self._get_read_url_local(book, mime_type=mime_type, user_id=user_id, base_url=base_url)
        return await self._get_read_url_s3(book, mime_type=mime_type)

    # ── S3 path ───────────────────────────────────────────────────────────────

    async def _get_read_url_s3(self, book: Book, *, mime_type: str) -> dict:
        bucket = settings.s3_upload_bucket
        s3 = self._s3()
        key = self._cache_key(book)

        try:
            s3.head_object(Bucket=bucket, Key=key)
            cache_hit = True
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code")
            # Without s3:ListBucket, S3 returns 403 instead of 404 for a missing key — there's
            # no way to tell "doesn't exist" apart from "no permission" without that extra grant,
            # so both are treated as a cache miss here. A genuine permission problem still surfaces
            # clearly below, from the put_object call that actually has to write the object.
            if error_code in ("404", "403", "AccessDenied"):
                cache_hit = False
            else:
                raise BookCacheServiceError(500, f"Could not check S3 book cache: {exc}")

        if not cache_hit:
            content = await self._onedrive.download_file_bytes(
                drive_id=book.onedrive_drive_id, item_id=book.onedrive_item_id
            )
            try:
                s3.put_object(Bucket=bucket, Key=key, Body=content, ContentType=mime_type)
            except ClientError as exc:
                raise BookCacheServiceError(500, f"Could not cache book in S3: {exc}")

        try:
            url = s3.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": bucket,
                    "Key": key,
                    "ResponseContentType": mime_type,
                    "ResponseContentDisposition": f'inline; filename="{book.file_name or "book"}"',
                },
                ExpiresIn=_PRESIGNED_URL_TTL_SECONDS,
            )
        except ClientError as exc:
            raise BookCacheServiceError(500, f"Could not generate book download URL: {exc}")

        return {"url": url, "expires_in": _PRESIGNED_URL_TTL_SECONDS, "cache_hit": cache_hit}

    # ── Local dev path ────────────────────────────────────────────────────────

    async def _get_read_url_local(
        self,
        book: Book,
        *,
        mime_type: str,
        user_id: int,
        base_url: str,
    ) -> dict:
        local_path = self._local_path(book)
        cache_hit = local_path.exists()

        if not cache_hit:
            content = await self._onedrive.download_file_bytes(
                drive_id=book.onedrive_drive_id, item_id=book.onedrive_item_id
            )
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(content)

        sig_hash = self._sig_hash(book)
        tok = self.local_token(user_id, book.id, sig_hash)
        from urllib.parse import quote
        url = (
            f"{base_url}/api/books/{book.id}/local-stream"
            f"?tok={tok}&uid={user_id}&h={sig_hash}&mt={quote(mime_type)}"
        )
        return {"url": url, "expires_in": _PRESIGNED_URL_TTL_SECONDS, "cache_hit": cache_hit}
