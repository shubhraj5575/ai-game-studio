/** FNV-1a hash — fast non-cryptographic checksum for saves/build manifests. */

export function fnv1a(data: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Second mixing pass for a wider avalanche (still not crypto).
  let h2 = 0x811c9dc5;
  for (let i = data.length - 1; i >= 0; i--) {
    h2 ^= data.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193);
  }
  return ((h >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0"));
}
