/**
 * Utility functions for the upload service.
 */

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function validateFilename(name: string): boolean {
  const forbidden = /[<>:"/\\|?*\x00-\x1f]/;
  return name.length > 0 && name.length <= 255 && !forbidden.test(name);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
