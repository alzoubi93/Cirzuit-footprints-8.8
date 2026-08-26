// Sync layer: keep PCB footprints + ratsnest in step with the schematic.
import { SchematicDoc } from "./schematic";
import { SYMBOLS, transformedPins } from "./symbols";
import { PcbDoc, PcbFootprint, PcbFootprintPad, PcbNet, PcbTrack, emptyPcbDoc } from "./pcb";
import { buildNetIndex } from "./netlist";
import { getPackagesForSymbol, ComponentPackage } from "./electronicsLibrary";
import { getElectrolyticSize } from "./electrolytic";
import { KicadFootprintRuntime } from "./kicad/footprint/kicadFootprintRuntime";
import { footprintToPcbFootprint, resolveRegisteredKicadFootprint } from "./kicad/footprint/kicadFootprint";
import { componentLink, applyPinPadMapping, buildPinPadLinks, deriveFootprintAssignment, buildPhysicalComponentGroups, applyPhysicalUnitAliases, getPhysicalComponentId, findPadIndexForPin, derivePhysicalFootprintAssignment, getSymbolPinNumbers } from "./componentLink";

/** Convert schematic grid units → millimetres. 2.54 mm = 100 mil = standard. */
export const SCH_TO_MM = 2.54;

export function makePadsForSymbol(symId: string, node?: any, pkgId?: string): PcbFootprintPad[] {
  const sym = SYMBOLS[symId];
  if (!sym) return [];

  const pkgs = getPackagesForSymbol(symId);
  const pkg = pkgs.find(p => p.id === pkgId) || pkgs[0]; // Use selected or first (default)

  if (symId.startsWith("CONN_")) {
    const meta = node?.metadata;
    if (meta?.type === "SCREW_TERMINAL" || symId.startsWith("CONN_SCREW_")) {
      const parts = symId.split("_");
      const poles = meta?.poles || parseInt(parts[2]?.replace("P", ""), 10) || sym.pins.length || 2;
      const pitch = meta?.pitch || parseFloat(parts[3]?.replace("MM", "")) || 5.08;
      
      let drillHole = meta?.drillHole;
      let padDiameter = meta?.padDiameter;

      if (!drillHole || !padDiameter) {
        if (pitch >= 5.0) {
          drillHole = 1.30;
          padDiameter = 2.40;
        } else {
          drillHole = 1.10;
          padDiameter = 1.90;
        }
      }

      return sym.pins.map((p, i) => {
        const x = (i - (poles - 1) / 2) * pitch;
        const y = 0;
        return {
          pinIndex: i,
          number: p.name,
          name: p.name,
          x,
          y,
          width: padDiameter,
          height: padDiameter,
          shape: i === 0 ? "rect" : "circle",
          layer: "multi_layer",
          drill: drillHole,
        };
      });
    }

    const parts = symId.split("_");
    const r_p = parts[2].split("x");
    const rows = parseInt(r_p[0], 10) || 1;
    const cols = parseInt(r_p[1], 10) || 1;
    const pitch = parseFloat(parts[3]) || 2.54;
    
    let drillHole = 1.00;
    let padDiameter = 1.70;
    
    if (Math.abs(pitch - 1.27) < 0.01) {
      drillHole = 0.65;
      padDiameter = 1.00;
    } else if (Math.abs(pitch - 2.00) < 0.01) {
      drillHole = 0.80;
      padDiameter = 1.30;
    } else {
      drillHole = 1.00;
      padDiameter = 1.70;
    }

    return sym.pins.map((p, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = (c - (cols - 1) / 2) * pitch;
      const y = (r - (rows - 1) / 2) * pitch;

      return {
        pinIndex: i,
        number: p.name,
        name: p.name,
        x,
        y,
        width: padDiameter,
        height: padDiameter,
        shape: i === 0 ? "rect" : "circle",
        layer: "multi_layer",
        drill: drillHole,
      };
    });
  }


  const actualPkgId = pkg.id;
  const idLower = symId.toLowerCase();

  const isPolarCap = 
    idLower.includes("capacitor_polar") || 
    idLower.includes("cpol") || 
    idLower.includes("cap_pol") ||
    idLower.includes("cp") ||
    idLower.includes("elko") ||
    (node?.reference && node.reference.toLowerCase().startsWith("c") && idLower.includes("polar"));
  if (isPolarCap && sym.pins.length >= 2) {
    const capVal = node?.value || node?.val || "10uF";
    const capSize = getElectrolyticSize(capVal);
    const pitch = capSize.pitch;
    return sym.pins.slice(0, 2).map((p, i) => {
      const padNumber = p.number ?? p.name ?? String(i + 1);
      return {
        pinIndex: i,
        number: padNumber,
        name: i === 0 ? "+" : "-",
        x: i === 0 ? -pitch / 2 : pitch / 2,
        y: 0,
        width: capSize.padDia,
        height: capSize.padDia,
        shape: i === 0 ? "rect" : "circle",
        layer: "multi_layer",
        drill: capSize.drill,
      };
    });
  }
  const isTransistorOrRegulator =
    idLower.includes("npn") ||
    idLower.includes("pnp") ||
    idLower.includes("transistor") ||
    idLower.includes("mosfet") ||
    idLower.includes("bjt") ||
    idLower.includes("2n2222") ||
    idLower.includes("bc547") ||
    idLower.includes("irf540") ||
    idLower.includes("regulator") ||
    idLower.includes("7805") ||
    idLower.includes("7812") ||
    idLower.includes("lm317") ||
    idLower.includes("ams1117");

  // TO-92 Footprint (IPC-7351 Standard: 3 inline pins with 2.54mm pitch)
  if (actualPkgId === "to92" || (isTransistorOrRegulator && pkg.type === "DIP" && !actualPkgId.includes("to220") && !idLower.includes("to220") && !idLower.includes("irf") && !idLower.includes("7805") && !idLower.includes("7812") && !idLower.includes("lm317"))) {
    const pitch = 2.54; // 100 mil standard IPC pitch
    return sym.pins.slice(0, 3).map((p, i) => {
      const padNumber = p.number ?? p.name ?? String(i + 1);
      return {
        pinIndex: i,
        number: padNumber,
        name: p.name,
        x: (i - 1) * pitch, // Pin 1: -2.54, Pin 2: 0, Pin 3: 2.54
        y: 0,
        width: pkg.padW || 1.5,
        height: pkg.padH || 1.5,
        shape: "circle",
        layer: "multi_layer",
        drill: pkg.drill || 0.8,
      };
    });
  }

  // TO-220 Footprint (IPC-7351 Standard: 3 power pins inline with 2.54mm pitch, 1.0mm drill)
  if (actualPkgId === "to220" || (isTransistorOrRegulator && pkg.type === "DIP" && (actualPkgId.includes("to220") || idLower.includes("to220") || idLower.includes("irf") || idLower.includes("7805") || idLower.includes("7812") || idLower.includes("lm317")))) {
    const pitch = 2.54;
    return sym.pins.slice(0, 3).map((p, i) => {
      const padNumber = p.number ?? p.name ?? String(i + 1);
      return {
        pinIndex: i,
        number: padNumber,
        name: p.name,
        x: (i - 1) * pitch, // Pin 1: -2.54, Pin 2: 0, Pin 3: 2.54
        y: 0,
        width: pkg.padW || 2.0,
        height: pkg.padH || 2.0,
        shape: "circle",
        layer: "multi_layer",
        drill: pkg.drill || 1.0,
      };
    });
  }

  // SOT-23 Footprint (IPC-7351 Standard SOT-23-3)
  if (actualPkgId === "sot23") {
    const sot23Pads = [
      { x: -0.95, y: -1.0, w: 0.8, h: 1.0 },
      { x: 0.95, y: -1.0, w: 0.8, h: 1.0 },
      { x: 0, y: 1.0, w: 0.8, h: 1.0 },
    ];
    return sym.pins.slice(0, 3).map((p, i) => {
      const padNumber = p.number ?? p.name ?? String(i + 1);
      const pos = sot23Pads[i] || { x: (i - 1) * 0.95, y: i === 2 ? 1.0 : -1.0, w: 0.8, h: 1.0 };
      return {
        pinIndex: i,
        number: padNumber,
        name: p.name,
        x: pos.x,
        y: pos.y,
        width: pos.w,
        height: pos.h,
        shape: "rect",
        layer: "top_copper",
        drill: 0,
      };
    });
  }

  // SOT-223 Footprint (IPC-7351 Standard)
  if (actualPkgId === "sot223") {
    const sot223Pads = [
      { x: -2.3, y: -3.1, w: 1.2, h: 1.6 },
      { x: 0, y: -3.1, w: 1.2, h: 1.6 },
      { x: 2.3, y: -3.1, w: 1.2, h: 1.6 },
      { x: 0, y: 3.1, w: 3.3, h: 1.8 },
    ];
    return sym.pins.map((p, i) => {
      const padNumber = p.number ?? p.name ?? String(i + 1);
      const pos = sot223Pads[i] || { x: (i - 1) * 2.3, y: -3.1, w: 1.2, h: 1.6 };
      return {
        pinIndex: i,
        number: padNumber,
        name: p.name,
        x: pos.x,
        y: pos.y,
        width: pos.w,
        height: pos.h,
        shape: "rect",
        layer: "top_copper",
        drill: 0,
      };
    });
  }

  // DPAK / TO-252 Footprint (IPC-7351 Standard)
  if (actualPkgId === "dpak") {
    const dpakPads = [
      { x: -2.28, y: -3.8, w: 1.4, h: 2.2 },
      { x: 2.28, y: -3.8, w: 1.4, h: 2.2 },
      { x: 0, y: 2.5, w: 6.2, h: 6.2 },
    ];
    return sym.pins.slice(0, 3).map((p, i) => {
      const padNumber = p.number ?? p.name ?? String(i + 1);
      const pos = dpakPads[i] || { x: 0, y: 0, w: 1.4, h: 2.2 };
      return {
        pinIndex: i,
        number: padNumber,
        name: p.name,
        x: pos.x,
        y: pos.y,
        width: pos.w,
        height: pos.h,
        shape: "rect",
        layer: "top_copper",
        drill: 0,
      };
    });
  }

  if (actualPkgId === "dip_300" || actualPkgId === "soic" || actualPkgId === "tssop") {
    const half = sym.pins.length / 2;
    let pitch = 2.54;
    let rowSpacing = 7.62;
    if (actualPkgId === "soic") {
      pitch = 1.27;
      rowSpacing = 5.90;
    } else if (actualPkgId === "tssop") {
      pitch = 0.65;
      rowSpacing = 5.70;
    }

    const padW = pkg.padW;
    const padH = pkg.padH;
    const drill = pkg.drill;

    return sym.pins.map((p, i) => {
      const padNumber = p.number ?? p.name ?? String(i + 1);
      const isLeft = p.x < sym.width / 2;
      const rowIdx = isLeft ? Math.round(p.y) - 1 : half - Math.round(p.y);

      const px = isLeft ? 0 : rowSpacing;
      const py = (rowIdx + 1) * pitch;

      return {
        pinIndex: i,
        number: padNumber,
        name: p.name,
        x: px,
        y: py,
        width: padW,
        height: padH,
        shape: pkg.type === "DIP" ? "circle" : "rect",
        layer: pkg.type === "DIP" ? "multi_layer" : "top_copper",
        drill: drill,
      };
    });
  }

  let scaleX = pkg.scaleX;
  const scaleY = pkg.scaleY;

  if (idLower.includes("esp32")) {
    scaleX = 25.4 / (6 * SCH_TO_MM); // standard 1.0 inch (25.4 mm) row spacing
  } else if (idLower.includes("esp8266") || idLower.includes("nodemcu")) {
    scaleX = 22.86 / (6 * SCH_TO_MM); // standard 0.9 inch (22.86 mm) row spacing
  } else if (idLower.includes("pico") || idLower.includes("rp2040")) {
    scaleX = 17.78 / (6 * SCH_TO_MM); // standard 0.7 inch (17.78 mm) row spacing
  } else if (idLower.includes("uno") || idLower.includes("mega")) {
    scaleX = 45.72 / (6 * SCH_TO_MM); // standard 1.8 inch (45.72 mm) row spacing
  } else if (idLower.includes("nano") || idLower.includes("mini")) {
    scaleX = 15.24 / (6 * SCH_TO_MM); // standard 0.6 inch (15.24 mm) row spacing
  } else if (idLower.includes("bluepill")) {
    scaleX = 15.24 / (6 * SCH_TO_MM); // standard 0.6 inch (15.24 mm) row spacing
  }

  const padW = pkg.padW;
  const padH = pkg.padH;
  const drill = pkg.drill;

  return sym.pins.map((p, i) => {
    // Use pin name if it's a number (common for ICs), otherwise fallback to index+1
    const padNumber = p.number ?? p.name ?? String(i + 1);
    
    return {
      pinIndex: i,
      number: padNumber,
      name: p.name,
      x: p.x * SCH_TO_MM * scaleX,
      y: p.y * SCH_TO_MM * scaleY,
      width: padW,
      height: padH,
      shape: pkg.type === "DIP" ? "circle" : "rect",
      layer: pkg.type === "DIP" ? "multi_layer" : "top_copper",
      drill: drill,
    };
  });
}

/** Lay out a brand-new footprint in a free spot inside the board. */
function pickInitialPosition(pcb: PcbDoc, index: number): { x: number; y: number } {
  const cols = Math.max(2, Math.floor(pcb.width / 10));
  const c = index % cols;
  const r = Math.floor(index / cols);
  return { x: 6 + c * 10, y: 6 + r * 10 };
}

/** Build a PCB net registry from the schematic net index and component links. */
export function buildPcbNetRegistry(schematic: SchematicDoc, footprints: PcbFootprint[]): { nets: PcbNet[]; unresolvedComponents: string[]; conflicts: string[] } {
  const idx = buildNetIndex(schematic);
  const fpById = new Map(footprints.map(fp => [fp.id, fp]));
  const unresolvedComponents: string[] = [];
  const conflicts: string[] = [];

  const nets: PcbNet[] = idx.nets.map(net => {
    const members = net.pins.map(pin => {
      const node = schematic.nodes.find(n => n.id === pin.nodeId);
      const physicalId = node ? getPhysicalComponentId(node, schematic.nodes) : pin.nodeId;
      const fp = fpById.get(physicalId);
      const padIndex = node && fp ? findPadIndexForPin(node, fp, pin.pinIndex) : -1;
      const pad = padIndex >= 0 ? fp?.pads[padIndex] : undefined;
      return {
        componentId: pin.nodeId,
        reference: schematic.nodes.find(n => n.id === pin.nodeId)?.reference,
        pinIndex: pin.pinIndex,
        pinNumber: getSymbolPinNumbers(schematic.nodes.find(n => n.id === pin.nodeId)!)[pin.pinIndex] ?? String(pin.pinIndex + 1),
        padIndex: padIndex >= 0 ? padIndex : undefined,
        padNumber: pad?.number ?? pad?.name,
      };
    });
    const missing = members.filter(m => m.padIndex === undefined);
    if (missing.length) {
      const refs = missing.map(m => `${m.reference ?? m.componentId}.${m.pinNumber}`).join(", ");
      conflicts.push(`${net.name}: missing PCB pad mapping for ${refs}`);
    }
    return {
      id: net.id,
      key: net.key,
      name: net.name,
      members,
      labels: net.labels,
      labelIds: net.labelIds,
      source: "schematic",
      status: missing.length ? "partial" : "complete",
    };
  });

  for (const group of buildPhysicalComponentGroups(schematic.nodes)) {
    const node = group.owner;
    const fp = fpById.get(node.id);
    if (!fp) {
      unresolvedComponents.push(node.reference || node.id);
      continue;
    }
    const link = componentLink(node, fp);
    if (link.assignment?.status === "missing" || link.assignment?.status === "mismatch") {
      unresolvedComponents.push(node.reference || node.id);
    }
  }

  return { nets, unresolvedComponents, conflicts };
}

/**
 * Push schematic connectivity onto the PCB without changing physical geometry.
 * Pads inherit net identity from their linked symbol pin; existing tracks/vias are
 * annotated by geometric connectivity and conflicts are reported, never silently
 * converted into a different electrical net.
 */
export function annotatePcbConnectivity(schematic: SchematicDoc, pcbIn: PcbDoc): PcbDoc {
  if (pcbIn.isImportedGerber) return pcbIn;
  const idx = buildNetIndex(schematic);
  const groups = buildPhysicalComponentGroups(schematic.nodes);
  const groupByOwner = new Map(groups.map(g => [g.owner.id, g]));
  const nextFootprints = (pcbIn.footprints ?? []).map(fp => {
    const group = groupByOwner.get(fp.id);
    return {
      ...fp,
      pads: fp.pads.map(pad => {
        const candidates: number[] = [];
        if (group) {
          for (const unit of group.units) {
            const pinIndex = pad.pinAliases?.find(a => a.componentId === unit.id)?.pinIndex;
            if (pinIndex !== undefined) {
              const netId = idx.pinNet.get(`${unit.id}:${pinIndex}`);
              if (netId !== undefined) candidates.push(netId);
            }
          }
        }
        const ownerNet = idx.pinNet.get(`${fp.id}:${pad.pinIndex}`);
        if (ownerNet !== undefined) candidates.push(ownerNet);
        const unique = Array.from(new Set(candidates));
        const netId = unique.length === 1 ? unique[0] : undefined;
        const net = netId === undefined ? undefined : idx.nets[netId];
        return netId === undefined
          ? { ...pad, netId: unique.length > 1 ? undefined : undefined, netKey: undefined, netName: undefined }
          : { ...pad, netId, netKey: net.key, netName: net.name };
      }),
    };
  });

  const padAnchors = nextFootprints.flatMap(fp => fp.pads.map(pad => {
    const r = rotateLocal({ x: pad.x, y: pad.y }, fp.rotation);
    return { fpId: fp.id, pad, x: fp.x + r.x, y: fp.y + r.y };
  }));

  // Connected track groups are the PCB-side physical representation of a net.
  const tracks = pcbIn.tracks ?? [];
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  const touches = (a: PcbTrack, b: PcbTrack) => {
    for (const pa of a.points) for (const pb of b.points) if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < 0.4) return true;
    return false;
  };
  for (const t of tracks) adjacency.set(t.id, new Set());
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      if (tracks[i].layer !== tracks[j].layer) continue;
      if (touches(tracks[i], tracks[j])) addEdge(tracks[i].id, tracks[j].id);
    }
  }

  const visited = new Set<string>();
  const conflicts: string[] = [];
  const nextTracks = tracks.map(t => ({ ...t }));
  for (const track of tracks) {
    if (visited.has(track.id)) continue;
    const group: PcbTrack[] = [];
    const queue = [track];
    visited.add(track.id);
    while (queue.length) {
      const current = queue.shift()!;
      group.push(current);
      for (const id of adjacency.get(current.id) ?? []) {
        if (!visited.has(id)) {
          visited.add(id);
          const other = tracks.find(t => t.id === id);
          if (other) queue.push(other);
        }
      }
    }
    const touched = padAnchors.filter(ap => group.some(t => t.points.some(pt => Math.hypot(pt.x - ap.x, pt.y - ap.y) < 0.6)));
    const netIds = Array.from(new Set(touched.map(t => t.pad.netId).filter((n): n is number => n !== undefined)));
    if (netIds.length === 1 && !touched.some(t => t.pad.netId === undefined)) {
      const net = idx.nets[netIds[0]];
      for (const t of group) {
        const target = nextTracks.find(x => x.id === t.id)!;
        target.netId = net.id;
        target.netKey = net.key;
        target.netName = net.name;
      }
    } else if (netIds.length > 1) {
      const names = netIds.map(id => idx.nets[id]?.name ?? `#${id}`).join(" / ");
      conflicts.push(`PCB track group ${group.map(t => t.id).join(", ")} merges nets: ${names}`);
      for (const t of group) {
        const target = nextTracks.find(x => x.id === t.id)!;
        target.netId = undefined;
        target.netKey = undefined;
        target.netName = undefined;
      }
    }
  }

  const nextVias = (pcbIn.vias ?? []).map(via => {
    let best: { netId: number; d: number } | null = null;
    for (const ap of padAnchors) {
      if (ap.pad.netId === undefined) continue;
      const d = Math.hypot(via.x - ap.x, via.y - ap.y);
      if (d < 0.7 && (!best || d < best.d)) best = { netId: ap.pad.netId, d };
    }
    if (!best) {
      for (const t of nextTracks) {
        if (t.netId === undefined) continue;
        for (const pt of t.points) {
          const d = Math.hypot(via.x - pt.x, via.y - pt.y);
          if (d < 0.7 && (!best || d < best.d)) best = { netId: t.netId, d };
        }
      }
    }
    const net = best ? idx.nets[best.netId] : undefined;
    return { ...via, netId: net?.id, netKey: net?.key, netName: net?.name };
  });

  const registry = buildPcbNetRegistry(schematic, nextFootprints);
  const allConflicts = [...registry.conflicts, ...conflicts];
  return {
    ...pcbIn,
    footprints: nextFootprints,
    tracks: nextTracks,
    vias: nextVias,
    nets: registry.nets,
    sync: {
      schematicVersion: schematic.version,
      synchronizedAt: Date.now(),
      componentCount: schematic.nodes.length,
      netCount: registry.nets.length,
      unresolvedComponents: registry.unresolvedComponents,
      conflicts: allConflicts,
    },
  };
}

/** Validate the logical Schematic↔PCB contract without mutating either document. */
export interface SchematicPcbValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  components: number;
  linkedComponents: number;
  nets: number;
}

export function validateSchematicPcbLink(schematic: SchematicDoc, pcb: PcbDoc | undefined): SchematicPcbValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!pcb) return { ok: false, errors: ["PCB document is missing"], warnings: [], components: schematic.nodes.length, linkedComponents: 0, nets: 0 };
  let linkedComponents = 0;
  for (const node of schematic.nodes) {
    const fp = pcb.footprints.find(f => f.id === node.id);
    if (!fp) {
      errors.push(`${node.reference ?? node.id}: footprint is missing`);
      continue;
    }
    linkedComponents++;
    const link = componentLink(node, fp);
    if (link.missingSymbolPins.length) errors.push(`${node.reference ?? node.id}: missing pads for pins ${link.missingSymbolPins.join(", ")}`);
    if (link.duplicatePads.length) errors.push(`${node.reference ?? node.id}: duplicate pads ${link.duplicatePads.join(", ")}`);
    if (link.missingPads.length) warnings.push(`${node.reference ?? node.id}: extra PCB pads ${link.missingPads.join(", ")}`);
    if (!link.assignment) warnings.push(`${node.reference ?? node.id}: no footprint assignment`);
  }
  for (const fp of pcb.footprints ?? []) {
    if (!schematic.nodes.some(n => n.id === fp.id) && !fp.id.startsWith("custom-fp-") && !fp.id.startsWith("kicad-fp-")) {
      warnings.push(`PCB footprint ${fp.reference ?? fp.id} is not linked to a schematic component`);
    }
  }

  // Multi-unit symbols are logically one physical component. CirZuit keeps the
  // unit identity on the schematic node so the linker can validate that future
  // unit-aware PCB consolidation is safe. Do not silently duplicate footprints.
  const groups = new Map<string, SchematicNode[]>();
  for (const node of schematic.nodes) {
    if (!node.unitGroupId) continue;
    const arr = groups.get(node.unitGroupId) ?? [];
    arr.push(node);
    groups.set(node.unitGroupId, arr);
  }
  for (const [groupId, nodes] of groups) {
    if (nodes.length < 2) warnings.push(`Multi-unit group ${groupId} contains only one unit instance`);
    const groupAssignment = derivePhysicalFootprintAssignment(nodes);
    if (groupAssignment.conflicts.length > 1) errors.push(`Multi-unit group ${groupId} has conflicting Footprint assignments: ${groupAssignment.conflicts.join(", ")}`);
    if (nodes.some(n => !n.unit || n.unit < 1)) warnings.push(`Multi-unit group ${groupId} has a unit without an explicit unit number`);
  }

  const registry = buildPcbNetRegistry(schematic, pcb.footprints ?? []);
  errors.push(...registry.conflicts);
  return { ok: errors.length === 0, errors, warnings, components: schematic.nodes.length, linkedComponents, nets: registry.nets.length };
}

/**
 * Reconcile only logical assignments from PCB back into the schematic. Physical
 * PCB position/rotation/routing remains PCB-owned and is deliberately not copied
 * into schematic coordinates.
 */
export function reconcileAssignmentsFromPcb(schematic: SchematicDoc, pcb: PcbDoc): SchematicDoc {
  const nextNodes = schematic.nodes.map(node => {
    const fp = pcb.footprints.find(f => f.id === node.id) ?? pcb.footprints.find(f => f.reference && f.reference === node.reference);
    if (!fp) return node;
    const source = fp.nativeKicadFootprint ? "kicad" : (fp.footprint && fp.footprint.includes(":") ? "kicad" : "cirzuit");
    const identifier = fp.footprint || fp.packageId;
    if (!identifier) return node;
    const mapping = buildPinPadLinks(node, fp);
    const status = mapping.missingSymbolPins.length || mapping.duplicatePads.length ? "mismatch" : "resolved";
    return {
      ...node,
      footprint: identifier,
      footprintAssignment: {
        source,
        identifier,
        library: source === "kicad" && identifier.includes(":") ? identifier.split(":")[0] : undefined,
        name: source === "kicad" && identifier.includes(":") ? identifier.split(":").slice(1).join(":") : identifier,
        displayName: identifier,
        status,
        pinPadMap: Object.fromEntries(mapping.links.map(l => [String(l.symbolPinIndex), l.padIndex])),
      },
    };
  });
  return { ...schematic, nodes: nextNodes };
}

/**
 * Reconcile pcb.footprints with the current schematic.
 */
export function syncPcbWithSchematic(schematic: SchematicDoc, pcbIn: PcbDoc, packageOptions?: Record<string, string>): PcbDoc {
  const pcb: PcbDoc = {
    ...pcbIn,
    footprints: pcbIn.footprints ?? [],
    ratsnestVisible: pcbIn.ratsnestVisible ?? true,
    tracks: pcbIn.tracks ?? [],
    vias: pcbIn.vias ?? [],
    pads: pcbIn.pads ?? [],
    measures: pcbIn.measures ?? [],
  };
  const byId = new Map(pcb.footprints.map((f) => [f.id, f]));
  let changed = pcb !== pcbIn;

  let nextIndex = pcb.footprints.length;
  const nextFps: PcbFootprint[] = [];
  const physicalGroups = buildPhysicalComponentGroups(schematic.nodes);

  for (const group of physicalGroups) {
    const node = group.owner;
    const prev = byId.get(node.id);
    const pkgId = packageOptions?.[node.id];
    const groupAssignment = derivePhysicalFootprintAssignment(group.units);
    const assignment = groupAssignment.assignment ?? deriveFootprintAssignment(node);
    const effectivePackageId = assignment?.source === "cirzuit" ? assignment.identifier : pkgId;
    const fallbackPads = makePadsForSymbol(node.symbol, node, effectivePackageId);
    const initialPos = prev ? { x: prev.x, y: prev.y } : pickInitialPosition(pcb, nextIndex++);
    let candidate: PcbFootprint;

    if (assignment?.source === "kicad") {
      const registered = resolveRegisteredKicadFootprint(assignment.identifier);
      const sameNative = prev?.nativeKicadFootprint?.fullName === assignment.identifier;
      if (registered) {
        const base = footprintToPcbFootprint(registered, node.id);
        candidate = {
          ...base,
          id: node.id,
          reference: node.reference,
          value: node.value || base.value,
          symbol: node.symbol,
          packageId: assignment.identifier,
          footprint: assignment.identifier,
          x: prev?.x ?? 0,
          y: prev?.y ?? 0,
          rotation: prev?.rotation ?? 0,
          nativeKicadFootprint: {
            ...base.nativeKicadFootprint!,
            properties: {
              ...(base.nativeKicadFootprint?.properties ?? {}),
              Reference: node.reference ?? base.nativeKicadFootprint?.properties?.Reference ?? "REF**",
              Value: node.value || base.nativeKicadFootprint?.properties?.Value || base.value || "VAL**",
            },
          },
        };
        candidate = applyPinPadMapping(node, candidate);
      } else if (sameNative) {
        candidate = applyPinPadMapping(node, {
          ...prev!,
          reference: node.reference,
          value: node.value,
          symbol: node.symbol,
          packageId: assignment.identifier,
          footprint: assignment.identifier,
          nativeKicadFootprint: prev?.nativeKicadFootprint
            ? {
                ...prev.nativeKicadFootprint,
                properties: {
                  ...prev.nativeKicadFootprint.properties,
                  Reference: node.reference ?? prev.nativeKicadFootprint.properties.Reference ?? "REF**",
                  Value: node.value || prev.nativeKicadFootprint.properties.Value || "VAL**",
                },
              }
            : undefined,
        });
      } else {
        // Keep the logical assignment even when the library model is not loaded.
        // A temporary CirZuit pad projection prevents the PCB from becoming empty;
        // the assignment remains marked as unresolved for the next ECO pass.
        candidate = {
          ...(prev ?? {}),
          id: node.id,
          reference: node.reference,
          value: node.value,
          symbol: node.symbol,
          packageId: assignment.identifier,
          footprint: assignment.identifier,
          x: initialPos.x,
          y: initialPos.y,
          rotation: prev?.rotation ?? 0,
          pads: fallbackPads,
          nativeKicadFootprint: undefined,
          source: undefined,
          metadata: { ...(prev?.metadata ?? {}), footprintResolution: "missing-kicad-model" },
        };
      }
    } else {
      candidate = {
        ...(prev ?? {}),
        id: node.id,
        reference: node.reference,
        value: node.value,
        symbol: node.symbol,
        packageId: effectivePackageId,
        footprint: assignment?.identifier || prev?.footprint,
        x: initialPos.x,
        y: initialPos.y,
        rotation: prev?.rotation ?? 0,
        pads: fallbackPads,
        nativeKicadFootprint: undefined,
        source: undefined,
      };
    }

    const link = buildPinPadLinks(node, candidate);
    candidate = applyPhysicalUnitAliases(candidate, group.units);
    const linkAfterAliases = buildPinPadLinks(node, candidate);
    candidate = {
      ...candidate,
      metadata: {
        ...(candidate.metadata ?? {}),
        componentLink: {
          componentId: node.id,
          reference: node.reference ?? "",
          symbolId: node.symbol,
          assignment,
          pinPadMap: Object.fromEntries(linkAfterAliases.links.map(l => [String(l.symbolPinIndex), l.padIndex])),
          missingSymbolPins: linkAfterAliases.missingSymbolPins,
          missingPads: linkAfterAliases.missingPads,
          duplicatePads: linkAfterAliases.duplicatePads,
          status: linkAfterAliases.missingSymbolPins.length || linkAfterAliases.duplicatePads.length ? "mismatch" : assignment ? "resolved" : "unassigned",
        },
      },
    };

    if (!prev || JSON.stringify(prev) !== JSON.stringify(candidate)) changed = true;
    nextFps.push(candidate);
  }

  // Preserve manually added custom footprints (which do not correspond to any schematic node)
  const ownerIds = new Set(physicalGroups.map(g => g.owner.id));
  for (const fp of pcb.footprints) {
    const isKnownOwner = ownerIds.has(fp.id);
    const isUnitInstance = schematic.nodes.some(n => n.id === fp.id && n.unitGroupId && !ownerIds.has(n.id));
    const isCustom = !isKnownOwner && !isUnitInstance;
    if (isCustom) {
      if (fp.id.startsWith("custom-fp-") || fp.id.startsWith("kicad-fp-")) {
        nextFps.push(fp);
      } else {
        changed = true;
      }
    }
  }

  // Electrical synchronization is additive: preserve existing PCB geometry and
  // annotate it with schematic net identity. Conflicting physical connections are
  // reported in pcb.sync instead of being silently deleted.
  return annotatePcbConnectivity(schematic, { ...pcb, footprints: nextFps });
}

/* ------------------------------ Ratsnest ------------------------------ */

export interface RatsnestPad {
  nodeId: string;
  pinIndex: number;
  x: number; y: number; // absolute mm
}

export interface RatsnestLine {
  netId: number;
  color: string;
  a: RatsnestPad;
  b: RatsnestPad;
}

const NET_COLORS = [
  "#f87171", "#facc15", "#34d399", "#60a5fa", "#a78bfa",
  "#f472b6", "#fb923c", "#22d3ee", "#84cc16", "#e879f9",
];
export const netColor = (id: number) => NET_COLORS[id % NET_COLORS.length];

/** Rotate a footprint-local pad position by the footprint's rotation. */
function rotateLocal(p: { x: number; y: number }, rot: number) {
  const r = (rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function getRatsnestPads(pcb: PcbDoc): Map<string, RatsnestPad> {
  const out = new Map<string, RatsnestPad>();
  for (const fp of pcb.footprints ?? []) {
    for (const pad of fp.pads) {
      const r = rotateLocal({ x: pad.x, y: pad.y }, fp.rotation);
      out.set(`${fp.id}:${pad.pinIndex}`, {
        nodeId: fp.id,
        pinIndex: pad.pinIndex,
        x: fp.x + r.x,
        y: fp.y + r.y,
      });
      for (const alias of pad.pinAliases ?? []) {
        out.set(`${alias.componentId}:${alias.pinIndex}`, {
          nodeId: alias.componentId,
          pinIndex: alias.pinIndex,
          x: fp.x + r.x,
          y: fp.y + r.y,
        });
      }
    }
  }
  return out;
}

/** Compute MST-style ratsnest lines from the schematic netlist + footprint geometry. */
export function computeRatsnest(schematic: SchematicDoc, pcb: PcbDoc): RatsnestLine[] {
  if (pcb?.isImportedGerber || !schematic?.nodes?.length) return [];
  const idx = buildNetIndex(schematic);
  const padPos = getRatsnestPads(pcb);
  const lines: RatsnestLine[] = [];
  for (const net of idx.nets) {
    if (net.pins.length < 2) continue;
    const pts: RatsnestPad[] = [];
    for (const p of net.pins) {
      const pp = padPos.get(`${p.nodeId}:${p.pinIndex}`);
      if (pp) pts.push(pp);
    }
    if (pts.length < 2) continue;
    const used = new Set<number>([0]);
    const remaining = new Set<number>(pts.map((_, i) => i).slice(1));
    const color = netColor(net.id);
    while (remaining.size) {
      let best: { i: number; j: number; d: number } | null = null;
      for (const i of used) {
        for (const j of remaining) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          if (!best || d < best.d) best = { i, j, d };
        }
      }
      if (!best) break;
      lines.push({ netId: net.id, color, a: pts[best.i], b: pts[best.j] });
      used.add(best.j);
      remaining.delete(best.j);
    }
  }
  return lines;
}

/** Bounding box (mm) of a footprint, used to draw an outline + select. */
export function footprintBBox(fp: PcbFootprint) {
  // Native KiCad footprint geometry is the source of truth. Do not use
  // component-name heuristics for imported .kicad_mod footprints.
  if (fp.nativeKicadFootprint) {
    // Exact native KiCad geometry is the only bounding-box source for imported
    // footprints. Do not infer dimensions from component names or pad rectangles.
    const runtime = new KicadFootprintRuntime(fp.nativeKicadFootprint);
    runtime.SetPosition({ x: fp.x, y: fp.y });
    runtime.SetOrientation(fp.rotation || 0);
    const b = runtime.GetGeometryBounds();
    return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  }

  if (!fp.pads.length) return { x: fp.x - 1, y: fp.y - 1, w: 2, h: 2 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const sym = (fp.symbol || "").toLowerCase();
  const ref = (fp.reference || "").toLowerCase();
  const val = (fp.value || "").toLowerCase();

  const isScrewTerminal = sym.startsWith("conn_screw") || sym.includes("screw") || sym.includes("terminal") || (fp as any).metadata?.type === "SCREW_TERMINAL";
  if (isScrewTerminal) {
    const poles = fp.pads.length || 2;
    let pitch = (fp as any).metadata?.pitch || 5.08;
    if (fp.pads.length > 1) {
      pitch = Math.hypot(fp.pads[1].x - fp.pads[0].x, fp.pads[1].y - fp.pads[0].y) || pitch;
    }
    const width = poles * pitch;
    const depth = 8.5;
    return {
      x: fp.x - width / 2,
      y: fp.y - depth / 2,
      w: width,
      h: depth,
    };
  }

  const isESP32 = sym.includes("esp32") || val.includes("esp32");
  const isESP8266 = sym.includes("esp8266") || val.includes("esp8266") || val.includes("nodemcu");
  const isArduinoNano = (sym.includes("arduino") && sym.includes("nano")) || (val.includes("arduino") && val.includes("nano"));
  const isArduinoMini = (sym.includes("arduino") && sym.includes("mini")) || (val.includes("arduino") && val.includes("mini"));
  const isArduinoUno = (sym.includes("arduino") && (sym.includes("uno") || sym.includes("mega"))) || (val.includes("arduino") && (val.includes("uno") || val.includes("mega")));
  const isRaspberryPico = sym.includes("pico") || sym.includes("rp2040") || val.includes("pico") || val.includes("rp2040");
  const isBoardController = isESP32 || isESP8266 || isArduinoNano || isArduinoMini || isArduinoUno || isRaspberryPico;

  if (isBoardController) {
    let bW = 20;
    let bH = 30;
    if (isESP32) { bW = 27.94; bH = 54.61; }
    else if (isESP8266) { bW = 25.4; bH = 48.0; }
    else if (isArduinoNano) { bW = 17.78; bH = 43.18; }
    else if (isArduinoMini) { bW = 17.78; bH = 33.02; }
    else if (isArduinoUno) { bW = 53.34; bH = 68.6; }
    else if (isRaspberryPico) { bW = 21.0; bH = 51.0; }

    let sumX = 0, sumY = 0;
    for (const p of fp.pads) {
      sumX += p.x;
      sumY += p.y;
    }
    const cx = sumX / fp.pads.length;
    const cy = sumY / fp.pads.length;

    const halfW = bW / 2;
    const halfH = bH / 2;
    const corners = [
      { x: cx - halfW, y: cy - halfH },
      { x: cx + halfW, y: cy - halfH },
      { x: cx - halfW, y: cy + halfH },
      { x: cx + halfW, y: cy + halfH },
    ];

    for (const c of corners) {
      const r = rotateLocal(c, fp.rotation);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x);
      maxY = Math.max(maxY, r.y);
    }
  } else {
    const isPolarCap = sym.includes("capacitor_polar") || sym.includes("cpol") || (ref.startsWith("c") && sym.includes("polar"));

    if (isPolarCap && fp.pads.length >= 2) {
      const pad0 = fp.pads[0];
      const pad1 = fp.pads[1];
      const capValRaw = fp.value || fp.value || "10uF";
      const capSize = getElectrolyticSize(capValRaw);
      const d = Math.hypot(pad0.x - pad1.x, pad0.y - pad1.y);
      const r = Math.max(capSize.w / 2, d / 2 + 0.3);
      const cx = (pad0.x + pad1.x) / 2;
      const cy = (pad0.y + pad1.y) / 2;
      const centerLocal = { x: cx, y: cy };
      const centerRotated = rotateLocal(centerLocal, fp.rotation);
      minX = centerRotated.x - r;
      minY = centerRotated.y - r;
      maxX = centerRotated.x + r;
      maxY = centerRotated.y + r;
    } else {
      for (const p of fp.pads) {
        const r = rotateLocal({ x: p.x, y: p.y }, fp.rotation);
        minX = Math.min(minX, r.x - p.width / 2);
        minY = Math.min(minY, r.y - p.height / 2);
        maxX = Math.max(maxX, r.x + p.width / 2);
        maxY = Math.max(maxY, r.y + p.height / 2);
      }
    }
  }

  const pad = 0.8;
  return {
    x: fp.x + minX - pad,
    y: fp.y + minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

export { emptyPcbDoc };

export interface EcoDiff {
  add: { id: string; reference: string; symbol: string }[];
  remove: { id: string; reference: string }[];
  update: { id: string; reference: string; changes: string[] }[];
  nets: {
    added: { key: string; name: string; members: number }[];
    removed: { key: string; name: string }[];
    changed: { key: string; name: string; changes: string[] }[];
  };
  labels: { added: string[]; removed: string[]; renamed: string[] };
  multiUnit: { physicalComponents: number; consolidated: string[]; conflicts: string[] };
  blocked: { id: string; reference: string; reason: string }[];
  warnings: string[];
}

export function computeEcoDiff(schematic: import("./schematic").SchematicDoc, pcb: PcbDoc | undefined): EcoDiff {
  const diff: EcoDiff = { add: [], remove: [], update: [], nets: { added: [], removed: [], changed: [] }, labels: { added: [], removed: [], renamed: [] }, multiUnit: { physicalComponents: buildPhysicalComponentGroups(schematic.nodes).length, consolidated: [], conflicts: [] }, blocked: [], warnings: [] };
  if (!pcb) return diff;
  
  const schNodes = new Map(schematic.nodes.map((n) => [n.id, n]));
  const pcbFps = new Map((pcb.footprints ?? []).map((f) => [f.id, f]));
  
  // Find Add & Update at physical-component level. Multi-unit units do not
  // create separate PCB footprints.
  for (const group of buildPhysicalComponentGroups(schematic.nodes)) {
    const node = group.owner;
    const fp = pcbFps.get(node.id);
    if (!fp) {
      diff.add.push({ id: node.id, reference: node.reference, symbol: node.symbol });
    } else {
      const changes: string[] = [];
      const assignment = deriveFootprintAssignment(node);
      const expectedPads = assignment?.source === "kicad" && fp.nativeKicadFootprint
        ? applyPinPadMapping(node, fp).pads
        : makePadsForSymbol(node.symbol, node, assignment?.source === "cirzuit" ? assignment.identifier : fp.packageId);
      const padsChanged = assignment?.source === "kicad"
        ? (!fp.nativeKicadFootprint || fp.nativeKicadFootprint.fullName !== assignment.identifier || JSON.stringify(fp.pads.map(p => ({ ...p, pinAliases: undefined }))) !== JSON.stringify(expectedPads.map(p => ({ ...p, pinAliases: undefined }))))
        : JSON.stringify(fp.pads.map(p => ({ ...p, pinAliases: undefined }))) !== JSON.stringify(expectedPads.map(p => ({ ...p, pinAliases: undefined })));

      if (fp.reference !== node.reference) changes.push(`Reference: ${fp.reference} ➔ ${node.reference}`);
      if (fp.value !== node.value) changes.push(`Value: ${fp.value || "None"} ➔ ${node.value || "None"}`);
      if (fp.symbol !== node.symbol) changes.push(`Symbol: ${fp.symbol} ➔ ${node.symbol}`);
      const currentAssignment = (fp.metadata as any)?.componentLink?.assignment?.identifier || fp.footprint || fp.packageId;
      if (assignment?.identifier && currentAssignment !== assignment.identifier) changes.push(`Footprint: ${currentAssignment || "None"} ➔ ${assignment.identifier}`);
      if (padsChanged) changes.push(`Pads configuration updated`);
      if (changes.length > 0) diff.update.push({ id: node.id, reference: node.reference, changes });
    }
  }
  
  // Find Remove
  for (const fp of pcb.footprints ?? []) {
    if (!schNodes.has(fp.id)) {
      diff.remove.push({ id: fp.id, reference: fp.reference });
      const hasPhysicalTracks = (pcb.tracks ?? []).some(t => t.points.some(pt => {
        return fp.pads.some(pad => {
          const r = rotateLocal({ x: pad.x, y: pad.y }, fp.rotation);
          return Math.hypot((fp.x + r.x) - pt.x, (fp.y + r.y) - pt.y) < 0.6;
        });
      }));
      if (hasPhysicalTracks) {
        diff.blocked.push({ id: fp.id, reference: fp.reference ?? fp.id, reason: "Footprint is scheduled for removal but has physically connected PCB routing." });
      }
    }
  }

  // Physical multi-unit ECO: one unit group must map to one PCB footprint.
  for (const group of buildPhysicalComponentGroups(schematic.nodes)) {
    if (group.units.length <= 1) continue;
    const ownerFp = pcbFps.get(group.owner.id);
    const groupAssignment = derivePhysicalFootprintAssignment(group.units);
    if (groupAssignment.conflicts.length > 1) {
      diff.multiUnit.conflicts.push(`${group.owner.reference ?? group.owner.id}: conflicting Footprint assignments`);
      diff.blocked.push({ id: group.owner.id, reference: group.owner.reference ?? group.owner.id, reason: "Multi-unit component has conflicting Footprint assignments." });
    }
    const duplicateUnitFps = group.units.slice(1).map(u => pcbFps.get(u.id)).filter(Boolean);
    if (!ownerFp) {
      diff.multiUnit.conflicts.push(`${group.owner.reference ?? group.owner.id}: owner footprint is missing`);
      diff.blocked.push({ id: group.owner.id, reference: group.owner.reference ?? group.owner.id, reason: "Multi-unit component has no physical owner footprint." });
    } else if (duplicateUnitFps.length) {
      diff.multiUnit.conflicts.push(`${group.owner.reference ?? group.owner.id}: duplicate physical footprints detected for units`);
      diff.blocked.push({ id: group.owner.id, reference: group.owner.reference ?? group.owner.id, reason: "Multi-unit component has more than one physical footprint." });
    } else {
      diff.multiUnit.consolidated.push(group.owner.reference ?? group.owner.id);
    }
  }

  // Net label ECO. Labels are logical source-of-truth data in the schematic.
  const currentLabels = new Map<string, string>();
  for (const n of pcb.nets ?? []) for (const label of n.labels ?? []) currentLabels.set(label.toLowerCase(), label);
  const nextLabels = new Map<string, string>();
  for (const label of schematic.netLabels ?? []) nextLabels.set(label.id, label.text);
  const nextNames = new Set(Array.from(nextLabels.values()).map(v => v.toLowerCase()));
  for (const name of currentLabels.keys()) if (!nextNames.has(name)) diff.labels.removed.push(currentLabels.get(name)!);
  for (const [id, text] of nextLabels) {
    const normalized = text.toLowerCase();
    if (!currentLabels.has(normalized)) diff.labels.added.push(text);
  }

  // Electrical net ECO: compare stable schematic net keys rather than volatile
  // numeric ids. This keeps the diff meaningful when net ordering changes.
  const nextRegistry = buildPcbNetRegistry(schematic, pcb.footprints ?? []);
  const currentNets = pcb.nets ?? [];
  const currentByKey = new Map(currentNets.map(n => [n.key, n]));
  const nextByKey = new Map(nextRegistry.nets.map(n => [n.key, n]));
  for (const net of nextRegistry.nets) {
    const current = currentByKey.get(net.key);
    if (!current) {
      diff.nets.added.push({ key: net.key, name: net.name, members: net.members.length });
    } else if (JSON.stringify(current.members) !== JSON.stringify(net.members) || current.status !== net.status) {
      const changes: string[] = [];
      if (current.members.length !== net.members.length) changes.push(`Members: ${current.members.length} → ${net.members.length}`);
      if (current.status !== net.status) changes.push(`Status: ${current.status ?? "unknown"} → ${net.status ?? "unknown"}`);
      if (changes.length) diff.nets.changed.push({ key: net.key, name: net.name, changes });
    }
  }
  for (const net of currentNets) {
    if (!nextByKey.has(net.key) && net.source === "schematic") {
      diff.nets.removed.push({ key: net.key, name: net.name });
    }
  }

  if (diff.blocked.length) diff.warnings.push(`${diff.blocked.length} ECO change(s) require manual review before execution.`);
  if (diff.multiUnit.conflicts.length) diff.warnings.push(`${diff.multiUnit.conflicts.length} multi-unit physical consolidation conflict(s) detected.`);
  return diff;
}
