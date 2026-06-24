from __future__ import annotations

import hashlib

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from memolink_backend.core.config import settings
from memolink_backend.domain.models.book import Book
from memolink_backend.business.services.onedrive_service import OneDriveService

# Presigned GET URLs are short-lived on purpose: long enough for a slow connection
# to finish downloading, short enough to limit how long a leaked URL stays usable.
_PRESIGNED_URL_TTL_SECONDS = 900


class BookCacheServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class BookCacheService:
    """Caches OneDrive book files in S3 and serves them via presigned URLs.

    Streaming book bytes through the backend breaks for any file over a few MB once
    deployed on Lambda, whose synchronous response payload is hard-capped at 6 MB
    (and Mangum's base64 encoding of binary bodies inflates that further). Routing
    the download through S3 instead lets the client fetch the file directly,
    bypassing that limit entirely.
    """

    def __init__(self, onedrive_service: OneDriveService):
        self._onedrive = onedrive_service

    def _s3(self):
        # A new client is created on each call - Lambda may rotate credentials, so
        # caching the client across invocations is intentionally avoided.
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

    async def get_read_url(self, book: Book, *, mime_type: str) -> dict:
        bucket = settings.s3_upload_bucket
        if not bucket:
            raise BookCacheServiceError(503, "S3 cache bucket is not configured on this server.")

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
