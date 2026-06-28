import React from "react";
import type { SourceFileMetadata } from "../../api/smartSourceApi";

function formatBytes(value: number | null): string {
  if (value == null) return "Unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function SourceMetadataTab({ source, localCacheStatus, rawContent }: { source: SourceFileMetadata | null; localCacheStatus: string; rawContent: string }) {
  if (!source) return <div className="p-6 text-sm text-gray-500"><p>No original source is linked to this note.</p><details className="mt-4"><summary className="cursor-pointer">Raw editor content</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{rawContent}</pre></details></div>;
  const rows = [
    ["Original filename", source.original_filename], ["Source type", source.source_type],
    ["MIME type", source.mime_type || "Unknown"], ["File size", formatBytes(source.file_size)],
    ["OneDrive drive ID", source.onedrive_drive_id], ["OneDrive item ID", source.onedrive_item_id],
    ["OneDrive version", source.onedrive_etag || "Unknown"], ["Extraction", source.extraction_status],
    ["Local cache (this device)", localCacheStatus], ["Linked note ID", String(source.note_id)],
    ["Last synced", source.last_synced_at ? new Date(source.last_synced_at).toLocaleString() : "Not recorded"],
  ];
  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-4 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs leading-relaxed text-gray-400">
        Original source files are stored in OneDrive. MemoLink stores metadata, extracted text, annotations, and timeline history. Local cached files stay on this device for faster viewing.
      </div>
      <dl className="grid grid-cols-[minmax(130px,0.4fr)_1fr] gap-x-4 gap-y-3 text-xs">
        {rows.map(([label, value]) => <React.Fragment key={label}><dt className="text-gray-500">{label}</dt><dd className="break-all text-gray-300">{value}</dd></React.Fragment>)}
      </dl>
      {source.onedrive_web_url && <a href={source.onedrive_web_url} target="_blank" rel="noreferrer" className="mt-5 inline-block text-xs text-indigo-400 hover:underline">Open original in OneDrive</a>}
      <details className="mt-5 border-t border-[var(--ml-bg-hover)] pt-4"><summary className="cursor-pointer text-xs text-gray-500">Raw extracted/editor content</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs text-gray-500">{rawContent}</pre></details>
    </div>
  );
}
