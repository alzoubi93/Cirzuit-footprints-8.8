import { describe, expect, it } from "vitest";
import { resolveKicadDisplayLayer } from "./kicadLayerAdapter";

describe("KiCad -> CirZuit layer presentation", () => {
  it("keeps wildcard copper on the active CirZuit side", () => {
    expect(resolveKicadDisplayLayer("*.Cu", "top_copper")).toBe("top_copper");
    expect(resolveKicadDisplayLayer("*.Cu", "bottom_copper")).toBe("bottom_copper");
  });

  it("maps explicit KiCad layers without changing their semantic identity", () => {
    expect(resolveKicadDisplayLayer("F.Cu", "top_copper")).toBe("top_copper");
    expect(resolveKicadDisplayLayer("B.Cu", "top_copper")).toBe("bottom_copper");
    expect(resolveKicadDisplayLayer("F.CrtYd", "top_copper")).toBe("top_courtyard");
    expect(resolveKicadDisplayLayer("B.Fab", "top_copper")).toBe("bottom_fab");
  });
});
