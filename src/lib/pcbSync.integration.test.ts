import { describe, expect, it } from "vitest";
import { emptyPcbDoc } from "./pcb";
import { buildNetIndex } from "./netlist";
import { syncPcbWithSchematic, validateSchematicPcbLink, buildPcbNetRegistry } from "./pcbSync";
import type { SchematicDoc } from "./schematic";

const schematic: SchematicDoc = {
  version: 2,
  canvasColor: "white",
  defaultWireColor: "black",
  nodes: [
    { id: "r1", symbol: "resistor", x: 10, y: 10, rotation: 0, reference: "R1", value: "10k", footprint: "res_dip_762", footprintAssignment: { source: "cirzuit", identifier: "res_dip_762", status: "resolved" } },
    { id: "r2", symbol: "resistor", x: 20, y: 10, rotation: 0, reference: "R2", value: "1k", footprint: "res_dip_762", footprintAssignment: { source: "cirzuit", identifier: "res_dip_762", status: "resolved" } },
  ],
  wires: [
    { id: "w1", points: [{ x: 14, y: 10.5 }, { x: 16, y: 10.5 }], color: "black" },
  ],
};

describe("V8.3+ Schematic ↔ PCB integration", () => {
  it("creates deterministic schematic net identities", () => {
    const a = buildNetIndex(schematic);
    const b = buildNetIndex(schematic);
    expect(a.nets.map(n => n.key)).toEqual(b.nets.map(n => n.key));
    expect(a.nets.every(n => /^N\d+$/.test(n.name))).toBe(true);
  });

  it("transfers component footprints and electrical net metadata", () => {
    const pcb = syncPcbWithSchematic(schematic, emptyPcbDoc());
    expect(pcb.footprints).toHaveLength(2);
    expect(pcb.nets?.length).toBeGreaterThan(0);
    expect(pcb.sync?.componentCount).toBe(2);
    expect(pcb.footprints.flatMap(fp => fp.pads).some(p => p.netId !== undefined)).toBe(true);
  });

  it("validates a synchronized design", () => {
    const pcb = syncPcbWithSchematic(schematic, emptyPcbDoc());
    const validation = validateSchematicPcbLink(schematic, pcb);
    expect(validation.components).toBe(2);
    expect(validation.linkedComponents).toBe(2);
    expect(validation.nets).toBeGreaterThan(0);
  });

  it("builds PCB net members using pin ↔ pad mapping", () => {
    const pcb = syncPcbWithSchematic(schematic, emptyPcbDoc());
    const registry = buildPcbNetRegistry(schematic, pcb.footprints);
    expect(registry.nets.every(n => n.members.every(m => m.padIndex !== undefined))).toBe(true);
  });
});
