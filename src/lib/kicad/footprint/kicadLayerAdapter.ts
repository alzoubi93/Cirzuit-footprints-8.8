/**
 * KiCad -> CirZuit PCB layer adapter.
 *
 * The KiCad token is kept authoritative.  This module only resolves how a
 * KiCad layer is presented inside CirZuit's existing visual layer system.
 * Native CirZuit footprint data is never rewritten by this adapter.
 */
export type CirZuitDisplayLayer = string;
export type CirZuitCopperLayer = "top_copper" | "bottom_copper";

export interface KicadLayerPresentation {
  kicad: string;
  cirzuit: string;
  visible: boolean;
  colorKey: string;
}

export function isCopperLayer(layer: string) {
  return layer === "F.Cu" || layer === "B.Cu" || layer === "*.Cu" || layer.endsWith(".Cu");
}

export function isTopLayer(layer: string) {
  return layer.startsWith("F.");
}

export function isBottomLayer(layer: string) {
  return layer.startsWith("B.");
}

/** Resolve wildcard KiCad layers using the user's active CirZuit side. */
export function resolveKicadDisplayLayer(layer: string, activeLayer: CirZuitDisplayLayer = "top_copper") {
  const side = activeLayer.startsWith("bottom_") ? "bottom" : "top";
  if (layer === "*.Cu") return side === "bottom" ? "bottom_copper" : "top_copper";
  if (layer === "*.Mask") return side === "bottom" ? "bottom_solder_mask" : "solder_mask";
  if (layer === "*.Paste") return side === "bottom" ? "bottom_paste" : "top_paste";

  switch (layer) {
    case "F.Cu": return "top_copper";
    case "B.Cu": return "bottom_copper";
    case "F.SilkS": return "silkscreen";
    case "B.SilkS": return "bottom_silkscreen";
    case "F.Mask": return "solder_mask";
    case "B.Mask": return "bottom_solder_mask";
    case "F.Paste": return "top_paste";
    case "B.Paste": return "bottom_paste";
    case "F.CrtYd": return "top_courtyard";
    case "B.CrtYd": return "bottom_courtyard";
    case "F.Fab": return "top_fab";
    case "B.Fab": return "bottom_fab";
    case "Edge.Cuts": return "outline";
    case "drill": return "drill";
    default: return layer;
  }
}

/**
 * KiCad layer visibility follows CirZuit's existing layer controls.  Auxiliary
 * KiCad layers (Fab/Courtyard/Paste) are considered visible unless the caller
 * explicitly hides them through the presentation map.
 */
export function isKicadLayerVisible(
  layer: string,
  visible: Record<string, boolean> = {},
  activeLayer: CirZuitDisplayLayer = "top_copper",
) {
  const resolved = resolveKicadDisplayLayer(layer, activeLayer);
  return visible[resolved] !== false;
}
