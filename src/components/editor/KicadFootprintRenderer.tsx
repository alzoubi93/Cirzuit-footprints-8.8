import React from "react";
import type { KicadFootprintModel } from "@/lib/kicad/footprint";
import { KicadFootprintRuntime } from "@/lib/kicad/footprint/kicadFootprintRuntime";
import { kicadGeometryEngine, type KicadGeometryItem, type KicadGeometryPrimitive } from "@/lib/kicad/footprint/geometry";
import { resolveKicadDisplayLayer, isKicadLayerVisible } from "@/lib/kicad/footprint/kicadLayerAdapter";

type Props = {
  footprint: KicadFootprintModel | KicadFootprintRuntime;
  reference?: string;
  value?: string;
  selected?: boolean;
  className?: string;
  interactive?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onGeometryPointerDown?: (e: React.PointerEvent, item: KicadGeometryItem) => void;
  onGeometryDoubleClick?: (e: React.MouseEvent, item: KicadGeometryItem) => void;
  /** CirZuit active PCB layer. KiCad wildcard layers resolve against this side. */
  activeLayer?: string;
  layerColors?: Record<string, string>;
  layerVisibility?: Record<string, boolean>;
  dimInactiveLayers?: boolean;
};

export function getKicadLayerColor(layer: string, layerColors: Record<string, string> = {}) {
  const appSilkColor = layerColors["silkscreen"] || "#fde047";
  const appBottomSilkColor = layerColors["bottom_silkscreen"] || layerColors["silkscreen"] || "#fde047";
  const appOutlineColor = layerColors["outline"] || "#eab308";
  const fabColor = layerColors["top_fab"] || layerColors["fab"] || "#94a3b8";
  const bottomFabColor = layerColors["bottom_fab"] || fabColor;
  const courtyardColor = layerColors["top_courtyard"] || layerColors["courtyard"] || "#c084fc";
  const bottomCourtyardColor = layerColors["bottom_courtyard"] || courtyardColor;

  const defaults: Record<string, string> = {
    top_copper: "#ef4444",
    bottom_copper: "#3b82f6",
    silkscreen: appSilkColor,
    bottom_silkscreen: appBottomSilkColor,
    solder_mask: "rgba(16,185,129,0.38)",
    bottom_solder_mask: "rgba(4,120,87,0.38)",
    top_paste: "rgba(215,185,111,0.55)",
    bottom_paste: "rgba(180,150,80,0.55)",
    top_courtyard: courtyardColor,
    bottom_courtyard: bottomCourtyardColor,
    top_fab: fabColor,
    bottom_fab: bottomFabColor,
    drill: "#0b1020",
    outline: appOutlineColor,
  };

  let color = layerColors[layer];

  if (!color) {
    if (layer === "top_fab" || layer === "F.Fab") {
      color = fabColor;
    } else if (layer === "bottom_fab" || layer === "B.Fab") {
      color = bottomFabColor;
    } else if (layer === "top_courtyard" || layer === "F.CrtYd") {
      color = courtyardColor;
    } else if (layer === "bottom_courtyard" || layer === "B.CrtYd") {
      color = bottomCourtyardColor;
    } else if (layer === "silkscreen" || layer === "F.SilkS") {
      color = appSilkColor;
    } else if (layer === "bottom_silkscreen" || layer === "B.SilkS") {
      color = appBottomSilkColor;
    } else if (layer === "outline" || layer === "Edge.Cuts") {
      color = appOutlineColor;
    } else if (layer === "top_copper" || layer === "F.Cu") {
      color = defaults.top_copper;
    } else if (layer === "bottom_copper" || layer === "B.Cu") {
      color = defaults.bottom_copper;
    } else {
      color = defaults[layer] || appSilkColor;
    }
  }

  return color || appSilkColor;
}

function isSideLayer(layer: string) {
  return layer.startsWith("F.") || layer.startsWith("B.");
}

function replaceSpecialText(text: string, reference: string, value: string) {
  return text
    .replace(/\$\{REFERENCE\}|%R/g, reference || "REF**")
    .replace(/\$\{VALUE\}|%V/g, value || "VAL**");
}

function roundedRectPath(cx: number, cy: number, w: number, h: number, r: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }) {
  const hx = w / 2, hy = h / 2;
  const tl = Math.min(r.topLeft, hx, hy), tr = Math.min(r.topRight, hx, hy), br = Math.min(r.bottomRight, hx, hy), bl = Math.min(r.bottomLeft, hx, hy);
  return [
    `M ${cx - hx + tl} ${cy - hy}`,
    `L ${cx + hx - tr} ${cy - hy}`,
    tr ? `A ${tr} ${tr} 0 0 1 ${cx + hx} ${cy - hy + tr}` : `L ${cx + hx} ${cy - hy}`,
    `L ${cx + hx} ${cy + hy - br}`,
    br ? `A ${br} ${br} 0 0 1 ${cx + hx - br} ${cy + hy}` : `L ${cx + hx} ${cy + hy}`,
    `L ${cx - hx + bl} ${cy + hy}`,
    bl ? `A ${bl} ${bl} 0 0 1 ${cx - hx} ${cy + hy - bl}` : `L ${cx - hx} ${cy + hy}`,
    `L ${cx - hx} ${cy - hy + tl}`,
    tl ? `A ${tl} ${tl} 0 0 1 ${cx - hx + tl} ${cy - hy}` : `L ${cx - hx} ${cy - hy}`,
    "Z",
  ].join(" ");
}

function chamferRectPath(
  cx: number,
  cy: number,
  w: number,
  h: number,
  c: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number },
  r: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number },
  rotation: number
) {
  const hx = w / 2, hy = h / 2;
  const tlc = Math.min(c.topLeft, hx, hy), trc = Math.min(c.topRight, hx, hy), brc = Math.min(c.bottomRight, hx, hy), blc = Math.min(c.bottomLeft, hx, hy);
  const tl = tlc ? 0 : r.topLeft, tr = trc ? 0 : r.topRight, br = brc ? 0 : r.bottomRight, bl = blc ? 0 : r.bottomLeft;
  const start = `M ${cx - hx + (tlc || tl)} ${cy - hy}`;
  const parts = [
    start,
    `L ${cx + hx - (trc || tr)} ${cy - hy}`,
    trc ? `L ${cx + hx} ${cy - hy + trc}` : (tr ? `A ${tr} ${tr} 0 0 1 ${cx + hx} ${cy - hy + tr}` : `L ${cx + hx} ${cy - hy}`),
    `L ${cx + hx} ${cy + hy - (brc || br)}`,
    brc ? `L ${cx + hx - brc} ${cy + hy}` : (br ? `A ${br} ${br} 0 0 1 ${cx + hx - br} ${cy + hy}` : `L ${cx + hx} ${cy + hy}`),
    `L ${cx - hx + (blc || bl)} ${cy + hy}`,
    blc ? `L ${cx - hx} ${cy + hy - blc}` : (bl ? `A ${bl} ${bl} 0 0 1 ${cx - hx} ${cy + hy - bl}` : `L ${cx - hx} ${cy + hy}`),
    `L ${cx - hx} ${cy - hy + (tlc || tl)}`,
    tlc ? `L ${cx - hx + tlc} ${cy - hy}` : (tl ? `A ${tl} ${tl} 0 0 1 ${cx - hx + tl} ${cy - hy}` : `L ${cx - hx} ${cy - hy}`),
    "Z"
  ];
  const d = parts.join(" ");
  return rotation ? { d, transform: `rotate(${rotation} ${cx} ${cy})` } : { d, transform: undefined };
}

function boxPath(points: { x: number; y: number }[]) {
  if (points.length < 4) return "";
  return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y} L ${points[2].x} ${points[2].y} L ${points[3].x} ${points[3].y} Z`;
}

function renderPrimitive(
  item: KicadGeometryItem,
  index: number,
  reference: string,
  value: string,
  activeLayer: string,
  layerColors: Record<string, string>,
  layerVisibility: Record<string, boolean>,
  dimInactiveLayers: boolean,
  footprintName?: string
) {
  const p = item.primitive;
  const isRef = p.kind === "text" && (
    p.role === "reference" ||
    p.text === "REF**" ||
    p.text === "${REFERENCE}" ||
    p.text === "%R"
  );
  const isVal = p.kind === "text" && (
    p.role === "value" ||
    p.text === "VAL**" ||
    p.text === "${VALUE}" ||
    p.text === "%V"
  );
  const isRefOrVal = isRef || isVal;
  const displayLayer = resolveKicadDisplayLayer(item.layer, activeLayer);
  if (!isKicadLayerVisible(item.layer, layerVisibility, activeLayer)) return null;

  const isAuxPadLayer = item.source === "pad" && (displayLayer === "solder_mask" || displayLayer === "bottom_solder_mask" || displayLayer === "top_paste" || displayLayer === "bottom_paste");
  const auxSelected = activeLayer === "solder_mask" || activeLayer === "bottom_solder_mask" || activeLayer === "top_paste" || activeLayer === "bottom_paste";
  if (isAuxPadLayer && !auxSelected) return null;

  const color = getKicadLayerColor(displayLayer, layerColors);
  const isCourtyard = displayLayer === "top_courtyard" || displayLayer === "bottom_courtyard" || item.layer === "F.CrtYd" || item.layer === "B.CrtYd";
  const isFab = displayLayer === "top_fab" || displayLayer === "bottom_fab" || item.layer === "F.Fab" || item.layer === "B.Fab";
  const isSilkscreen = displayLayer === "silkscreen" || displayLayer === "bottom_silkscreen" || item.layer === "F.SilkS" || item.layer === "B.SilkS";
  const isCopper = displayLayer === "top_copper" || displayLayer === "bottom_copper" || item.layer === "F.Cu" || item.layer === "B.Cu" || item.layer === "*.Cu";

  const isSideLayer = (layer: string) => layer.startsWith("F.") || layer.startsWith("B.");
  const inactiveSide = isSideLayer(item.layer) && ((item.layer.startsWith("F.") && activeLayer !== "top_copper") || (item.layer.startsWith("B.") && activeLayer !== "bottom_copper"));
  const opacity = dimInactiveLayers && inactiveSide ? 0.35 : 1.0;

  // Authentic KiCad stroke widths
  const defaultStroke = isCourtyard ? 0.05 : isFab ? 0.12 : isSilkscreen ? 0.15 : 0.15;
  const rawWidth = p.stroke?.width ? p.stroke.width : defaultStroke;
  const strokeWidth = isCourtyard ? Math.max(0.05, rawWidth) : Math.max(0.1, rawWidth);
  const strokeDasharray = isCourtyard ? "0.5 0.3" : undefined;

  // Authentic Layer-Specific Body Fill and Graphic Fill
  let fillColor = "none";
  let fillOpacity: number | undefined = undefined;

  if (isCopper) {
    fillColor = color;
    fillOpacity = 1.0;
  } else if (p.fill || p.kind === "polygon") {
    if (isSilkscreen) {
      fillColor = color;
      fillOpacity = 1.0;
    } else if (isFab) {
      fillColor = "rgba(148, 163, 184, 0.25)";
      fillOpacity = 0.85;
    } else if (isCourtyard) {
      fillColor = "rgba(192, 132, 252, 0.08)";
      fillOpacity = 0.6;
    } else {
      fillColor = color;
      fillOpacity = 0.5;
    }
  }

  const strokeColor = isCopper ? (p.fill ? color : "none") : color;

  const common = {
    stroke: strokeColor,
    strokeWidth: p.fill && isCopper ? 0 : strokeWidth,
    opacity,
    strokeDasharray,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    pointerEvents: isCopper ? "auto" as const : "none" as const,
  };

  switch (p.kind) {
    case "line":
      return <line key={index} x1={p.start.x} y1={p.start.y} x2={p.end.x} y2={p.end.y} fill="none" {...common} />;
    case "rect": {
      const cx = (p.start.x + p.end.x) / 2;
      const cy = (p.start.y + p.end.y) / 2;
      return (
        <rect
          key={index}
          x={Math.min(p.start.x, p.end.x)}
          y={Math.min(p.start.y, p.end.y)}
          width={Math.abs(p.end.x - p.start.x)}
          height={Math.abs(p.end.y - p.start.y)}
          rx={p.radius || 0}
          fill={fillColor}
          fillOpacity={fillOpacity}
          transform={p.rotation ? `rotate(${p.rotation} ${cx} ${cy})` : undefined}
          {...common}
        />
      );
    }
    case "roundrect": {
      const path = roundedRectPath(p.center.x, p.center.y, p.size.x, p.size.y, p.radii);
      return (
        <path
          key={index}
          d={path}
          fill={fillColor}
          fillOpacity={fillOpacity}
          transform={p.rotation ? `rotate(${p.rotation} ${p.center.x} ${p.center.y})` : undefined}
          {...common}
        />
      );
    }
    case "chamferrect": {
      const path = chamferRectPath(p.center.x, p.center.y, p.size.x, p.size.y, p.chamfers, p.radii, p.rotation);
      return <path key={index} d={path.d} fill={fillColor} fillOpacity={fillOpacity} transform={path.transform} {...common} />;
    }
    case "circle":
      return <circle key={index} cx={p.center.x} cy={p.center.y} r={p.radius} fill={fillColor} fillOpacity={fillOpacity} {...common} />;
    case "polygon":
      return (
        <polygon
          key={index}
          points={p.points.map(q => `${q.x} ${q.y}`).join(" ")}
          fill={fillColor}
          fillOpacity={fillOpacity}
          style={{ pointerEvents: isCopper ? "auto" : "none" }}
          {...common}
        />
      );
    case "arc": {
      const large = Math.abs(p.sweepRadians) > Math.PI ? 1 : 0;
      const sweep = p.sweepRadians >= 0 ? 1 : 0;
      const d = `M ${p.start.x} ${p.start.y} A ${p.radius} ${p.radius} 0 ${large} ${sweep} ${p.end.x} ${p.end.y}`;
      return <path key={index} d={d} fill={fillColor} fillOpacity={fillOpacity} {...common} />;
    }
    case "bezier": {
      if (p.points.length < 2) return null;
      let d = `M ${p.points[0].x} ${p.points[0].y}`;
      if (p.points.length === 4) {
        d += ` C ${p.points[1].x} ${p.points[1].y}, ${p.points[2].x} ${p.points[2].y}, ${p.points[3].x} ${p.points[3].y}`;
      } else if (p.points.length === 3) {
        d += ` Q ${p.points[1].x} ${p.points[1].y} ${p.points[2].x} ${p.points[2].y}`;
      } else {
        for (const q of p.points.slice(1)) d += ` L ${q.x} ${q.y}`;
      }
      return <path key={index} d={d} fill={fillColor} fillOpacity={fillOpacity} {...common} />;
    }
    case "capsule": {
      const dx = p.end.x - p.start.x;
      const dy = p.end.y - p.start.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return <circle key={index} cx={p.start.x} cy={p.start.y} r={p.radius} fill={fillColor} fillOpacity={fillOpacity} {...common} />;
      const nx = -dy / len;
      const ny = dx / len;
      const a = { x: p.start.x + nx * p.radius, y: p.start.y + ny * p.radius };
      const b = { x: p.end.x + nx * p.radius, y: p.end.y + ny * p.radius };
      const c = { x: p.end.x - nx * p.radius, y: p.end.y - ny * p.radius };
      const d = { x: p.start.x - nx * p.radius, y: p.start.y - ny * p.radius };
      const path = `M ${a.x} ${a.y} L ${b.x} ${b.y} A ${p.radius} ${p.radius} 0 0 1 ${c.x} ${c.y} L ${d.x} ${d.y} A ${p.radius} ${p.radius} 0 0 1 ${a.x} ${a.y} Z`;
      return <path key={index} d={path} fill={fillColor} fillOpacity={fillOpacity} {...common} />;
    }
    case "hole":
      return (
        <g key={index}>
          <ellipse
            cx={p.center.x}
            cy={p.center.y}
            rx={p.size.x / 2}
            ry={p.size.y / 2}
            transform={p.rotation ? `rotate(${p.rotation} ${p.center.x} ${p.center.y})` : undefined}
            fill="#0b1020"
            stroke="#1e293b"
            strokeWidth={0.06}
          />
        </g>
      );
    case "text": {
      // Authentic KiCad: text marked hide in the source file is not rendered, reference included
      if (!p.visible) return null;
      let text = p.text;
      if (isRef) {
        text = reference || "REF**";
      } else if (isVal) {
        // Authentic KiCad: the Value field is shown as-is (by default this is the
        // footprint's own name, exactly as KiCad's footprint editor displays it).
        text = value || p.text;
      } else {
        text = replaceSpecialText(p.text, reference, value);
      }
      if (!text || text === "~") return null;

      const transform = `translate(${p.position.x} ${p.position.y}) rotate(${p.rotation})${p.mirror ? " scale(-1 1)" : ""}`;
      const box = p.boxPoints && p.boxPoints.length === 4 ? boxPath(p.boxPoints) : (p.boxEnd ? `M ${p.position.x} ${p.position.y} L ${p.boxEnd.x} ${p.position.y} L ${p.boxEnd.x} ${p.boxEnd.y} L ${p.position.x} ${p.boxEnd.y} Z` : "");
      // Authentic KiCad: text color strictly adheres to its layer color
      const textColor = color;
      const textFontSize = p.size.y ? Math.max(0.35, p.size.y) : (isRefOrVal ? 0.75 : 0.4);
      return (
        <g key={index}>
          {box && <path d={box} fill={p.boxFill ? textColor : "none"} stroke={p.stroke.width > 0 ? textColor : "none"} strokeWidth={Math.max(0.1, p.stroke.width)} />}
          <text
            x={0}
            y={0}
            transform={transform}
            fill={textColor}
            fontSize={textFontSize}
            fontWeight={isRef || p.bold ? 700 : 400}
            fontStyle={p.italic ? "italic" : "normal"}
            textAnchor={p.anchor}
            opacity={opacity}
            fontFamily="monospace"
          >
            {text}
          </text>
        </g>
      );
    }
  }
}

const LAYER_ORDER: Record<string, number> = {
  "B.Cu": 10,
  "bottom_copper": 10,
  "F.Cu": 20,
  "top_copper": 20,
  "*.Cu": 20,
  "drill": 25,
  "B.SilkS": 30,
  "bottom_silkscreen": 30,
  "F.SilkS": 40,
  "silkscreen": 40,
  "B.Fab": 50,
  "bottom_fab": 50,
  "F.Fab": 60,
  "top_fab": 60,
  "B.CrtYd": 70,
  "F.CrtYd": 70,
  "top_courtyard": 70,
  "bottom_courtyard": 70,
};

function buildItems(footprint: KicadFootprintModel | KicadFootprintRuntime) {
  if (!footprint) return [];
  let rawItems: KicadGeometryItem[] = [];
  if (typeof (footprint as KicadFootprintRuntime).GetWorldGeometry === "function") {
    rawItems = (footprint as KicadFootprintRuntime).GetWorldGeometry() || [];
  } else {
    const local = kicadGeometryEngine.buildFootprint(footprint.graphics || [], footprint.pads || []);
    rawItems = kicadGeometryEngine.transformed(local, {
      position: footprint.position || { x: 0, y: 0 },
      rotation: footprint.rotation || 0,
      scaleX: 1,
      scaleY: 1,
      flipped: footprint.layer === "B.Cu",
    });
  }

  // Sort by layer stack order so Fab is bottom, Copper is mid, Silk is top, Courtyard is overlay
  return [...rawItems].sort((a, b) => {
    const orderA = LAYER_ORDER[a.layer] ?? 50;
    const orderB = LAYER_ORDER[b.layer] ?? 50;
    return orderA - orderB;
  });
}

export function KicadFootprintRenderer({
  footprint,
  reference = "REF**",
  value = footprint?.name || "",
  selected,
  interactive,
  onPointerDown,
  onDoubleClick,
  onGeometryPointerDown,
  onGeometryDoubleClick,
  activeLayer = "top_copper",
  layerColors = {},
  layerVisibility = {},
  dimInactiveLayers = false
}: Props) {
  if (!footprint) return null;
  const items = buildItems(footprint);
  const hasRenderedRef = items.some(item => {
    const p = item.primitive;
    if (p.kind !== "text") return false;
    return (
      p.role === "reference" ||
      p.text === "REF**" ||
      p.text === "${REFERENCE}" ||
      p.text === "%R" ||
      p.text.includes("%R") ||
      p.text.includes("${REFERENCE}") ||
      p.text.trim().toUpperCase() === "U" ||
      p.text.trim().toUpperCase() === "U?" ||
      p.text.trim().toUpperCase() === "REF" ||
      /^(REF|\*|\?|U|\$\{REFERENCE\}|%R)+$/i.test(p.text.trim())
    );
  });
  const bounds = !hasRenderedRef ? kicadGeometryEngine.bounds(items) : null;

  // Separate primitives by layer stacking order for crisp rendering
  const rendered = items.map((item, i) => {
    const element = renderPrimitive(item, i, reference, value, activeLayer, layerColors, layerVisibility, dimInactiveLayers, footprint?.name);
    if (!element) return null;
    return (
      <g
        key={`geometry-hit-${item.id ?? i}`}
        data-kicad-geometry-id={item.id}
        onPointerDown={onGeometryPointerDown ? (e) => { e.stopPropagation(); onGeometryPointerDown(e, item); } : undefined}
        onDoubleClick={onGeometryDoubleClick ? (e) => { e.stopPropagation(); onGeometryDoubleClick(e, item); } : undefined}
      >
        {element}
      </g>
    );
  });

  return (
    <g onPointerDown={interactive ? onPointerDown : undefined} onDoubleClick={interactive ? onDoubleClick : undefined} style={interactive ? { cursor: "pointer" } : undefined}>
      {rendered}
      {!hasRenderedRef && reference && bounds && (
        <text
          x={(bounds.minX + bounds.maxX) / 2}
          y={bounds.minY - 0.8}
          textAnchor="middle"
          fontSize={Math.max(0.8, Math.min(1.4, (bounds.maxY - bounds.minY) * 0.35))}
          fill={layerColors["silkscreen"] || "#fde047"}
          fontWeight={700}
          pointerEvents="none"
          fontFamily="monospace"
        >
          {reference}
        </text>
      )}
      {/* Pad numbers: positioned cleanly inside the pad boundaries */}
      {(footprint.pads || []).map((pad, i) => {
        const displayLayer = resolveKicadDisplayLayer(pad.layers[0] || "F.Cu", activeLayer);
        if (!isKicadLayerVisible(pad.layers[0] || "F.Cu", layerVisibility, activeLayer)) return null;

        const numStr = String(pad.number || pad.name || (typeof (pad as any).pinIndex === 'number' ? (pad as any).pinIndex + 1 : ""));
        if (!numStr) return null;

        const pw = pad.size.x || 1;
        const ph = pad.size.y || 1;
        const charCount = Math.max(1, numStr.length);
        const padRot = pad.rotation || 0;
        const isTall = ph > pw * 1.35;
        const isWide = pw > ph * 1.35;

        let fontSize: number;
        let textRot = padRot;

        if (isTall && pw < 0.75) {
          textRot = padRot + 90;
          const maxThick = pw * 0.75;
          const maxLen = ph * 0.85;
          fontSize = Math.min(maxThick, maxLen / (charCount * 0.62), 0.55);
        } else if (isWide && ph < 0.75) {
          const maxThick = ph * 0.75;
          const maxLen = pw * 0.85;
          fontSize = Math.min(maxThick, maxLen / (charCount * 0.62), 0.55);
        } else {
          const maxW = pw * 0.85;
          const maxH = ph * 0.8;
          fontSize = Math.min(maxH, maxW / (charCount * 0.62), 0.9);
        }

        if (fontSize < 0.15) return null;

        return (
          <text
            key={`pad-number-${numStr}-${i}`}
            x={pad.position.x}
            y={pad.position.y}
            transform={textRot ? `rotate(${textRot} ${pad.position.x} ${pad.position.y})` : undefined}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={fontSize}
            fill="#ffffff"
            fontWeight={700}
            opacity={dimInactiveLayers && pad.layers.every(l => l.startsWith("F.") || l === "F.Cu") && activeLayer === "bottom_copper" ? 0.45 : 1.0}
            pointerEvents="none"
            fontFamily="monospace"
          >
            {numStr}
          </text>
        );
      })}
    </g>
  );
}

export function nativeFootprintBounds(fp: KicadFootprintModel | KicadFootprintRuntime) {
  const items = buildItems(fp);
  return kicadGeometryEngine.bounds(items);
}

