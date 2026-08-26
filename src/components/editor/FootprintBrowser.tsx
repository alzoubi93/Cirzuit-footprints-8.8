import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Library,
  RefreshCw,
  Search,
  Sparkles,
  X,
  Eye,
  Box,
  Cpu,
  Cable,
  Zap,
  Sliders,
  Microchip,
  Radio,
  Layers,
  Loader2,
  Check,
  Plus,
  FileUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";
import {
  classifyFootprintMountingType,
  kicadFootprintLibrary,
  kicadFootprintRuntime,
  readKicadFootprintDefinition,
  type KicadFootprintLibraryEntry,
  type KicadFootprintModel,
  type KicadFootprintRuntime,
} from "@/lib/kicad/footprint";
import { KicadFootprintRenderer, nativeFootprintBounds } from "./KicadFootprintRenderer";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport?: (footprint: KicadFootprintModel) => void;
  onGenerate?: () => void;
  /** Assignment mode selects a library footprint for a schematic component without placing it on the PCB. */
  selectionOnly?: boolean;
  onSelect?: (footprint: KicadFootprintModel) => void;
}

type FootprintCategory = "all" | "ic_packages" | "connectors" | "passives" | "semiconductors" | "switches" | "modules";

function buildGeneratorModel(params: {
  packageType: "DIP" | "SOIC" | "QFP" | "Passive" | "RadialCap";
  pinCount: number;
  pitch: number;
  rowSpacing: number;
  padWidth: number;
  padHeight: number;
  drill: number;
  prefix: string;
  value: string;
}): KicadFootprintModel {
  const { packageType, pinCount, pitch, rowSpacing, padWidth, padHeight, drill, prefix, value } = params;

  const pads: KicadFootprintPad[] = [];
  const graphics: KicadFootprintGraphic[] = [];

  if (packageType === "DIP" || packageType === "SOIC") {
    const half = Math.max(1, Math.floor(pinCount / 2));
    const isDip = packageType === "DIP";
    for (let i = 0; i < half; i++) {
      const py = (i - (half - 1) / 2) * pitch;
      const px = -rowSpacing / 2;
      pads.push({
        number: String(i + 1),
        type: isDip ? "thru_hole" : "smd",
        shape: isDip ? "circle" : "rect",
        position: { x: px, y: py },
        size: { x: padWidth, y: padHeight },
        rotation: 0,
        layers: isDip ? ["B.Cu", "F.Cu", "F.Mask", "B.Mask"] : ["F.Cu", "F.Mask", "F.Paste"],
        drill: isDip ? drill : undefined,
      });
    }
    for (let i = 0; i < half; i++) {
      const py = ((half - 1 - i) - (half - 1) / 2) * pitch;
      const px = rowSpacing / 2;
      const padNum = half + i + 1;
      pads.push({
        number: String(padNum),
        type: isDip ? "thru_hole" : "smd",
        shape: isDip ? "circle" : "rect",
        position: { x: px, y: py },
        size: { x: padWidth, y: padHeight },
        rotation: 0,
        layers: isDip ? ["B.Cu", "F.Cu", "F.Mask", "B.Mask"] : ["F.Cu", "F.Mask", "F.Paste"],
        drill: isDip ? drill : undefined,
      });
    }

    const bodyWidth = Math.max(rowSpacing - padWidth - 0.5, 2);
    const bodyHeight = (half - 1) * pitch + padHeight + 1;
    graphics.push({
      kind: "rect",
      layer: "F.SilkS",
      start: { x: -bodyWidth / 2, y: -bodyHeight / 2 },
      end: { x: bodyWidth / 2, y: bodyHeight / 2 },
      stroke: { width: 0.15 },
    });
    graphics.push({
      kind: "circle",
      layer: "F.SilkS",
      center: { x: -bodyWidth / 2 + 0.6, y: -bodyHeight / 2 + 0.6 },
      end: { x: -bodyWidth / 2 + 0.8, y: -bodyHeight / 2 + 0.6 },
      fill: "solid",
      stroke: { width: 0.15 },
    });
  } else if (packageType === "QFP") {
    const sideCount = Math.max(1, Math.floor(pinCount / 4));
    let pinNum = 1;
    for (let i = 0; i < sideCount; i++) {
      const py = (i - (sideCount - 1) / 2) * pitch;
      const px = -rowSpacing / 2;
      pads.push({
        number: String(pinNum++),
        type: "smd",
        shape: "rect",
        position: { x: px, y: py },
        size: { x: padHeight, y: padWidth },
        rotation: 0,
        layers: ["F.Cu", "F.Mask", "F.Paste"],
      });
    }
    for (let i = 0; i < sideCount; i++) {
      const px = (i - (sideCount - 1) / 2) * pitch;
      const py = rowSpacing / 2;
      pads.push({
        number: String(pinNum++),
        type: "smd",
        shape: "rect",
        position: { x: px, y: py },
        size: { x: padWidth, y: padHeight },
        rotation: 0,
        layers: ["F.Cu", "F.Mask", "F.Paste"],
      });
    }
    for (let i = 0; i < sideCount; i++) {
      const py = ((sideCount - 1 - i) - (sideCount - 1) / 2) * pitch;
      const px = rowSpacing / 2;
      pads.push({
        number: String(pinNum++),
        type: "smd",
        shape: "rect",
        position: { x: px, y: py },
        size: { x: padHeight, y: padWidth },
        rotation: 0,
        layers: ["F.Cu", "F.Mask", "F.Paste"],
      });
    }
    for (let i = 0; i < sideCount; i++) {
      const px = ((sideCount - 1 - i) - (sideCount - 1) / 2) * pitch;
      const py = -rowSpacing / 2;
      pads.push({
        number: String(pinNum++),
        type: "smd",
        shape: "rect",
        position: { x: px, y: py },
        size: { x: padWidth, y: padHeight },
        rotation: 0,
        layers: ["F.Cu", "F.Mask", "F.Paste"],
      });
    }
    const bodySize = Math.max(rowSpacing - padHeight - 0.5, 2);
    graphics.push({
      kind: "rect",
      layer: "F.SilkS",
      start: { x: -bodySize / 2, y: -bodySize / 2 },
      end: { x: bodySize / 2, y: bodySize / 2 },
      stroke: { width: 0.15 },
    });
  } else if (packageType === "RadialCap") {
    pads.push({
      number: "1",
      type: "thru_hole",
      shape: "rect",
      position: { x: -pitch / 2, y: 0 },
      size: { x: padWidth, y: padHeight },
      rotation: 0,
      layers: ["B.Cu", "F.Cu", "F.Mask", "B.Mask"],
      drill,
    });
    pads.push({
      number: "2",
      type: "thru_hole",
      shape: "circle",
      position: { x: pitch / 2, y: 0 },
      size: { x: padWidth, y: padHeight },
      rotation: 0,
      layers: ["B.Cu", "F.Cu", "F.Mask", "B.Mask"],
      drill,
    });
    const capRadius = pitch * 1.2;
    graphics.push({
      kind: "circle",
      layer: "F.SilkS",
      center: { x: 0, y: 0 },
      end: { x: capRadius, y: 0 },
      stroke: { width: 0.15 },
    });
  } else {
    // Passive
    pads.push({
      number: "1",
      type: "smd",
      shape: "rect",
      position: { x: -pitch / 2, y: 0 },
      size: { x: padWidth, y: padHeight },
      rotation: 0,
      layers: ["F.Cu", "F.Mask", "F.Paste"],
    });
    pads.push({
      number: "2",
      type: "smd",
      shape: "rect",
      position: { x: pitch / 2, y: 0 },
      size: { x: padWidth, y: padHeight },
      rotation: 0,
      layers: ["F.Cu", "F.Mask", "F.Paste"],
    });
    const bodyW = Math.max(pitch - padWidth, 0.5);
    graphics.push({
      kind: "rect",
      layer: "F.SilkS",
      start: { x: -bodyW / 2, y: -padHeight / 2 - 0.2 },
      end: { x: bodyW / 2, y: padHeight / 2 + 0.2 },
      stroke: { width: 0.15 },
    });
  }

  return {
    id: `generated-${packageType}-${Date.now()}`,
    library: "Generator",
    name: value || packageType,
    fullName: `Generator:${value || packageType}`,
    layer: "F.Cu",
    position: { x: 0, y: 0 },
    rotation: 0,
    properties: {
      Reference: prefix || "U",
      Value: value || packageType,
    },
    graphics,
    pads,
    models: [],
    source: {
      path: `generator/${packageType}`,
      type: "imported",
    },
  };
}

function classifyFootprintLibrary(name: string): FootprintCategory {
  const lower = name.toLowerCase();
  if (
    lower.startsWith("package_") ||
    lower.includes("bga") ||
    lower.includes("qfp") ||
    lower.includes("qfn") ||
    lower.includes("soic") ||
    lower.includes("dip") ||
    lower.includes("lqfp") ||
    lower.includes("tssop") ||
    lower.includes("dfn") ||
    lower.includes("son") ||
    lower.includes("sip")
  ) {
    return "ic_packages";
  }
  if (
    lower.startsWith("connector") ||
    lower.includes("pinheader") ||
    lower.includes("pinsocket") ||
    lower.includes("terminalblock") ||
    lower.includes("socket") ||
    lower.includes("plug") ||
    lower.includes("jack") ||
    lower.includes("usb") ||
    lower.includes("rj45") ||
    lower.includes("molex") ||
    lower.includes("jst")
  ) {
    return "connectors";
  }
  if (
    lower.startsWith("resistor") ||
    lower.startsWith("capacitor") ||
    lower.startsWith("inductor") ||
    lower.startsWith("transformer") ||
    lower.startsWith("potentiometer") ||
    lower.includes("ferrite")
  ) {
    return "passives";
  }
  if (
    lower.startsWith("diode") ||
    lower.startsWith("led") ||
    lower.startsWith("transistor") ||
    lower.startsWith("display") ||
    lower.startsWith("crystal") ||
    lower.startsWith("oscillator") ||
    lower.includes("optodevice") ||
    lower.includes("sensor")
  ) {
    return "semiconductors";
  }
  if (
    lower.startsWith("button") ||
    lower.startsWith("relay") ||
    lower.startsWith("fuse") ||
    lower.startsWith("buzzer") ||
    lower.includes("switch")
  ) {
    return "switches";
  }
  if (
    lower.startsWith("module") ||
    lower.startsWith("rf_") ||
    lower.startsWith("battery") ||
    lower.includes("converter") ||
    lower.includes("shield") ||
    lower.includes("esp32") ||
    lower.includes("arduino")
  ) {
    return "modules";
  }
  return "all";
}

function FootprintPreview({
  footprint,
  className = "w-full h-full",
}: {
  footprint: KicadFootprintModel | KicadFootprintRuntime | null;
  className?: string;
}) {
  if (!footprint) {
    return (
      <div className="h-full grid place-items-center text-xs text-slate-500">
        No footprint selected
      </div>
    );
  }
  const b = nativeFootprintBounds(footprint);
  const rawW = b.maxX - b.minX;
  const rawH = b.maxY - b.minY;
  const w = Math.max(1.2, Number.isFinite(rawW) ? rawW : 5);
  const h = Math.max(1.2, Number.isFinite(rawH) ? rawH : 5);
  const pad = Math.max(0.6, Math.max(w, h) * 0.09);
  const minX = Number.isFinite(b.minX) ? b.minX : -w / 2;
  const minY = Number.isFinite(b.minY) ? b.minY : -h / 2;

  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <KicadFootprintRenderer footprint={footprint} reference="REF**" value={footprint.name} />
    </svg>
  );
}

function FootprintThumbnailCard({
  entry,
  library,
  onSelect,
  onInspect,
  actionLabel,
}: {
  entry: KicadFootprintLibraryEntry;
  library: string;
  onSelect: (model: KicadFootprintModel) => void;
  onInspect: (model: KicadFootprintModel, entry: KicadFootprintLibraryEntry) => void;
  actionLabel?: string;
}) {
  const [model, setModel] = useState<KicadFootprintModel | null>(() => kicadFootprintLibrary.getCached(entry.path) || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!model) {
      setLoading(true);
      kicadFootprintLibrary
        .load(entry)
        .then((m) => {
          if (active) {
            setModel(m);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) {
            setLoading(false);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [entry, model]);

  const padCount = model ? ("GetPads" in model ? (model as any).GetPads().length : model.pads?.length ?? 0) : 0;
  const mounting = model ? classifyFootprintMountingType("GetRenderModel" in model ? (model as any).GetRenderModel() : model) : null;
  const bounds = model ? nativeFootprintBounds(model) : null;
  const widthMm = bounds ? Math.max(0.1, bounds.maxX - bounds.minX) : 0;
  const heightMm = bounds ? Math.max(0.1, bounds.maxY - bounds.minY) : 0;

  return (
    <div
      className="group relative flex flex-col justify-between p-2 sm:p-2.5 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-900 hover:border-blue-500/40 transition-all shadow-sm cursor-pointer"
      onClick={() => {
        if (model) onInspect(model, entry);
      }}
    >
      {/* Footprint Visual Preview (Directly shown below/with component name) */}
      <div className="w-full bg-slate-950/80 rounded-lg p-2 flex items-center justify-center min-h-[90px] h-[95px] sm:min-h-[105px] sm:h-[110px] border border-slate-800/80 relative overflow-hidden">
        {model ? (
          <FootprintPreview footprint={model} className="w-full h-full" />
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-1 text-slate-500 text-xs">
            <Loader2 className="size-4 animate-spin text-blue-500" />
            <span className="text-[10px] font-mono">Loading…</span>
          </div>
        ) : (
          <div className="text-[10px] text-slate-600 text-center font-mono">Footprint</div>
        )}

        {/* Badges */}
        {model && (
          <>
            <span className="absolute bottom-1 end-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-slate-300 shadow-sm">
              {padCount} {padCount === 1 ? "pad" : "pads"}
            </span>
            {mounting && mounting !== "Unknown" && (
              <span
                className={`absolute top-1 start-1 text-[9px] font-semibold px-1.5 py-0.5 rounded border shadow-sm ${
                  mounting === "SMD"
                    ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
                    : mounting === "THT"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    : "bg-purple-500/10 text-purple-400 border-purple-500/30"
                }`}
              >
                {mounting}
              </span>
            )}
          </>
        )}
      </div>

      {/* Footprint Title & Dimensions */}
      <div className="mt-2 space-y-0.5">
        <div className="text-xs font-bold font-mono text-slate-100 truncate" title={entry.name}>
          {entry.name}
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span className="truncate font-mono">
            {widthMm > 0 ? `${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm` : entry.library}
          </span>
        </div>
      </div>

      {/* Card Action Controls */}
      <div
        className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-end gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-2 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 shrink-0"
          onClick={() => {
            if (model) onInspect(model, entry);
            else {
              kicadFootprintLibrary.load(entry).then((m) => onInspect(m, entry));
            }
          }}
          title="معاينة البصمة"
        >
          <Eye className="size-3" />
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-2 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 shrink-0"
          onClick={async () => {
            if (model) {
              const full = { ...model, library: model.library || library };
              onSelect(full);
            } else {
              setLoading(true);
              try {
                const m = await kicadFootprintLibrary.load(entry);
                const full = { ...m, library: m.library || library };
                onSelect(full);
              } finally {
                setLoading(false);
              }
            }
          }}
          title={actionLabel || "استيراد"}
        >
          <Download className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export function FootprintBrowser({
  open,
  onOpenChange,
  onImport,
  onGenerate,
  selectionOnly = false,
  onSelect,
}: Props) {
  const { lang } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mainTab, setMainTab] = useState<"import" | "generator">("import");
  const [libraries, setLibraries] = useState<string[]>([]);
  const [library, setLibrary] = useState("");
  const [activeCategory, setActiveCategory] = useState<FootprintCategory>("all");
  const [entries, setEntries] = useState<KicadFootprintLibraryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<KicadFootprintModel | KicadFootprintRuntime | null>(null);
  const [view, setView] = useState<"libraries" | "footprints" | "preview">("libraries");
  const [loading, setLoading] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Footprint Generator State
  const [genType, setGenType] = useState<"DIP" | "SOIC" | "QFP" | "Passive" | "RadialCap">("DIP");
  const [genPinCount, setGenPinCount] = useState<number>(8);
  const [genPitch, setGenPitch] = useState<number>(2.54);
  const [genRowSpacing, setGenRowSpacing] = useState<number>(7.62);
  const [genPadWidth, setGenPadWidth] = useState<number>(1.5);
  const [genPadHeight, setGenPadHeight] = useState<number>(1.5);
  const [genDrill, setGenDrill] = useState<number>(0.8);
  const [genPrefix, setGenPrefix] = useState<string>("U");
  const [genValue, setGenValue] = useState<string>("DIP-8");

  useEffect(() => {
    if (genType === "DIP") {
      setGenPinCount(8);
      setGenPitch(2.54);
      setGenRowSpacing(7.62);
      setGenPadWidth(1.5);
      setGenPadHeight(1.5);
      setGenDrill(0.8);
      setGenPrefix("U");
      setGenValue("DIP-8");
    } else if (genType === "SOIC") {
      setGenPinCount(8);
      setGenPitch(1.27);
      setGenRowSpacing(5.0);
      setGenPadWidth(1.5);
      setGenPadHeight(0.6);
      setGenDrill(0);
      setGenPrefix("U");
      setGenValue("SOIC-8");
    } else if (genType === "QFP") {
      setGenPinCount(32);
      setGenPitch(0.8);
      setGenRowSpacing(10.0);
      setGenPadWidth(1.2);
      setGenPadHeight(0.4);
      setGenDrill(0);
      setGenPrefix("U");
      setGenValue("QFP-32");
    } else if (genType === "Passive") {
      setGenPinCount(2);
      setGenPitch(2.0);
      setGenRowSpacing(0);
      setGenPadWidth(1.0);
      setGenPadHeight(1.2);
      setGenDrill(0);
      setGenPrefix("R");
      setGenValue("10k");
    } else if (genType === "RadialCap") {
      setGenPinCount(2);
      setGenPitch(2.54);
      setGenRowSpacing(0);
      setGenPadWidth(1.5);
      setGenPadHeight(1.5);
      setGenDrill(0.8);
      setGenPrefix("C");
      setGenValue("10uF");
    }
  }, [genType]);

  const generatedModel = useMemo(() => {
    return buildGeneratorModel({
      packageType: genType,
      pinCount: genPinCount,
      pitch: genPitch,
      rowSpacing: genRowSpacing,
      padWidth: genPadWidth,
      padHeight: genPadHeight,
      drill: genDrill,
      prefix: genPrefix,
      value: genValue,
    });
  }, [genType, genPinCount, genPitch, genRowSpacing, genPadWidth, genPadHeight, genDrill, genPrefix, genValue]);

  const handleLocalFileSelect = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) return;
        const model = readKicadFootprintDefinition(text, {
          path: file.name,
          type: "imported",
        });
        if (model) {
          handleInspect(model);
        }
      } catch (err) {
        setError(lang === "ar" ? "تعذر قراءة ملف البصمة المحدد." : "Failed to parse selected footprint file.");
      }
    };
    reader.readAsText(file);
  };

  const initialize = async () => {
    setLoading(true);
    setError(null);
    try {
      await kicadFootprintLibrary.initialize();
      const libs = kicadFootprintLibrary.libraries();
      setLibraries(libs);
      setLibrary((cur) => cur || libs.find((x) => x === "Package_DIP") || libs[0] || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      if (!kicadFootprintLibrary.isInitialized()) initialize();
      else {
        setLibraries(kicadFootprintLibrary.libraries());
        setView("libraries");
      }
    }
  }, [open]);

  const loadLibrary = async (name: string) => {
    setLibrary(name);
    setLoadingLibrary(true);
    setError(null);
    try {
      const all = await kicadFootprintLibrary.ensureLibrary(name);
      setEntries([...all.filter((e) => e.library === name)]);
      setSelected(null);
      setQuery("");
      setView("footprints");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingLibrary(false);
    }
  };

  const filteredLibraries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return libraries.filter((l) => {
      if (activeCategory !== "all" && classifyFootprintLibrary(l) !== activeCategory) {
        return false;
      }
      if (!q) return true;
      return l.toLowerCase().includes(q);
    });
  }, [libraries, query, activeCategory]);

  const filteredFootprints = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => !q || `${e.library}:${e.name}`.toLowerCase().includes(q)).slice(0, 1000);
  }, [entries, query]);

  const handleInspect = (model: KicadFootprintModel) => {
    const runtime = kicadFootprintRuntime.register(model);
    setSelected(runtime);
    setView("preview");
  };

  const handleSelectFootprint = (model: KicadFootprintModel) => {
    const full = "GetRenderModel" in model ? (model as any).GetRenderModel() : model;
    if (!full.library && library) full.library = library;
    if (selectionOnly) onSelect?.(full);
    else onImport?.(full);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideCloseButton={true} className="max-w-none w-screen h-[100dvh] sm:w-[95vw] sm:max-w-4xl sm:h-[88vh] sm:max-h-[850px] p-0 flex flex-col gap-0 overflow-hidden bg-slate-950 border-slate-800 text-white rounded-none sm:rounded-2xl">
        {/* Header with 2 Tabs and Safe Close Button */}
        <DialogHeader className="px-3 sm:px-6 py-2 sm:py-3 border-b border-slate-800 shrink-0 bg-slate-900/80">
          <div className="flex items-center justify-between gap-2 sm:gap-4 w-full">
            {/* Tabs List */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 overflow-x-auto py-0.5 no-scrollbar shrink min-w-0">
              <button
                type="button"
                onClick={() => setMainTab("import")}
                className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 sm:gap-2 border shrink-0 whitespace-nowrap ${
                  mainTab === "import"
                    ? "bg-blue-600/20 text-blue-400 border-blue-500/40 shadow-sm shadow-blue-500/10"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-slate-800/80"
                }`}
              >
                <Download className="size-3.5 sm:size-4 text-blue-400 shrink-0" />
                <span>{lang === "ar" ? "استيراد KiCad Footprints" : "Import KiCad Footprints"}</span>
              </button>

              <button
                type="button"
                onClick={() => setMainTab("generator")}
                className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 sm:gap-2 border shrink-0 whitespace-nowrap ${
                  mainTab === "generator"
                    ? "bg-blue-600/20 text-blue-400 border-blue-500/40 shadow-sm shadow-blue-500/10"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-slate-800/80"
                }`}
              >
                <Cpu className="size-3.5 sm:size-4 text-blue-400 shrink-0" />
                <span>{lang === "ar" ? "توليد البصمات" : "Footprint Generator"}</span>
              </button>
            </div>

            {/* Dedicated Close Button */}
            <DialogClose className="h-8 w-8 shrink-0 text-blue-400 hover:text-white hover:bg-blue-600/20 border-2 border-blue-500/80 hover:border-blue-400 rounded-lg transition-all flex items-center justify-center shadow-sm shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <X className="h-4 w-4 stroke-[2.5]" />
              <span className="sr-only">{lang === "ar" ? "إغلاق" : "Close"}</span>
            </DialogClose>
          </div>
        </DialogHeader>

        {/* Main Content Area */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {error && (
            <div className="m-3 p-3 rounded-lg border border-red-900/70 bg-red-950/30 text-xs text-red-200 shrink-0">
              <div className="flex items-start gap-2">
                <span className="flex-1 break-words">{error}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setError(null)}>
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-hidden">
            {/* TAB 2: FOOTPRINT GENERATOR */}
            {mainTab === "generator" && (
              <div className="h-full flex flex-col lg:flex-row overflow-y-auto bg-slate-950">
                {/* Generator Form */}
                <div className="w-full lg:w-96 border-b lg:border-b-0 lg:border-e border-slate-800 p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto max-h-full bg-slate-900/40 shrink-0">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 pb-2 border-b border-slate-800 flex items-center gap-2">
                    <Sparkles className="size-4 text-blue-400" />
                    <span>{lang === "ar" ? "تخصيص أبعاد ومواصفات البصمة" : "Footprint Generator Settings"}</span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-slate-300">{lang === "ar" ? "نوع الحزمة" : "Package Type"}</label>
                      <select
                        className="w-full h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-white shadow-sm transition-colors focus:outline-none focus:border-blue-500"
                        value={genType}
                        onChange={(e) => setGenType(e.target.value as any)}
                      >
                        <option value="DIP">{lang === "ar" ? "DIP (ثقوب نافذة)" : "DIP (Through-hole)"}</option>
                        <option value="SOIC">{lang === "ar" ? "SOIC (سطحي صفين)" : "SOIC (SMD Dual)"}</option>
                        <option value="QFP">{lang === "ar" ? "QFP (سطحي 4 أسطح)" : "QFP (SMD Quad)"}</option>
                        <option value="Passive">{lang === "ar" ? "سطحي بسيط (مقاومة/مكثف)" : "Passive SMD"}</option>
                        <option value="RadialCap">{lang === "ar" ? "مكثف قطبي شعاعي (Radial)" : "Radial Polarized Cap"}</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-slate-300">{lang === "ar" ? "البادئة (Ref)" : "Prefix"}</label>
                        <Input
                          className="h-9 text-xs bg-slate-900 border-slate-700 text-white"
                          value={genPrefix}
                          onChange={(e) => setGenPrefix(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-slate-300">{lang === "ar" ? "القيمة (Value)" : "Value"}</label>
                        <Input
                          className="h-9 text-xs bg-slate-900 border-slate-700 text-white"
                          value={genValue}
                          onChange={(e) => setGenValue(e.target.value)}
                        />
                      </div>
                    </div>

                    {genType !== "Passive" && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-slate-300">{lang === "ar" ? "عدد الأرجل" : "Pin Count"}</label>
                        <Input
                          type="number"
                          className="h-9 text-xs bg-slate-900 border-slate-700 text-white"
                          value={genPinCount}
                          onChange={(e) => setGenPinCount(parseInt(e.target.value) || 2)}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-slate-300">{lang === "ar" ? "الخطوة Pitch (mm)" : "Pitch (mm)"}</label>
                        <Input
                          type="number"
                          step="0.01"
                          className="h-9 text-xs bg-slate-900 border-slate-700 text-white font-mono"
                          value={genPitch}
                          onChange={(e) => setGenPitch(parseFloat(e.target.value) || 0)}
                        />
                      </div>

                      {genType !== "Passive" && (
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-slate-300">{lang === "ar" ? "تباعد الصفوف (mm)" : "Row Spacing (mm)"}</label>
                          <Input
                            type="number"
                            step="0.01"
                            className="h-9 text-xs bg-slate-900 border-slate-700 text-white font-mono"
                            value={genRowSpacing}
                            onChange={(e) => setGenRowSpacing(parseFloat(e.target.value) || 0)}
                          />
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-slate-300">{lang === "ar" ? "عرض الوسادة (mm)" : "Pad Width (mm)"}</label>
                        <Input
                          type="number"
                          step="0.01"
                          className="h-9 text-xs bg-slate-900 border-slate-700 text-white font-mono"
                          value={genPadWidth}
                          onChange={(e) => setGenPadWidth(parseFloat(e.target.value) || 0)}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-slate-300">{lang === "ar" ? "ارتفاع الوسادة (mm)" : "Pad Height (mm)"}</label>
                        <Input
                          type="number"
                          step="0.01"
                          className="h-9 text-xs bg-slate-900 border-slate-700 text-white font-mono"
                          value={genPadHeight}
                          onChange={(e) => setGenPadHeight(parseFloat(e.target.value) || 0)}
                        />
                      </div>

                      {(genType === "DIP" || genType === "RadialCap") && (
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-slate-300">{lang === "ar" ? "قطر الثقب Drill (mm)" : "Drill (mm)"}</label>
                          <Input
                            type="number"
                            step="0.01"
                            className="h-9 text-xs bg-slate-900 border-slate-700 text-white font-mono"
                            value={genDrill}
                            onChange={(e) => setGenDrill(parseFloat(e.target.value) || 0)}
                          />
                        </div>
                      )}
                    </div>

                    <Button
                      className="w-full h-10 text-xs font-bold gap-2 bg-blue-600 hover:bg-blue-500 text-white mt-4 shadow-lg shadow-blue-900/30 active:scale-[0.99] transition-all"
                      onClick={() => handleSelectFootprint(generatedModel)}
                    >
                      <Sparkles className="size-4" />
                      <span>
                        {selectionOnly
                          ? (lang === "ar" ? "تعيين هذه البصمة المولدة" : "Assign Generated Footprint")
                          : (lang === "ar" ? "توليد وإضافة للوحة (PCB)" : "Generate & Add to Board")}
                      </span>
                    </Button>
                  </div>
                </div>

                {/* Live Interactive Preview */}
                <div className="flex-1 min-h-[280px] p-4 flex flex-col gap-2 bg-slate-950 overflow-hidden">
                  <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
                    <span>{lang === "ar" ? "معاينة هندسية حية للبصمة" : "Live Visual Footprint Preview"}</span>
                    <span className="font-mono text-[10px] text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-900/50">
                      {generatedModel.pads.length} Pads ({genType})
                    </span>
                  </div>
                  <div className="flex-1 border border-slate-800 rounded-xl bg-slate-950 p-2 relative overflow-hidden flex items-center justify-center shadow-inner">
                    <FootprintPreview footprint={generatedModel} className="w-full h-full" />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 1: IMPORT KICAD FOOTPRINTS */}
            {mainTab === "import" && (
              <div className="h-full flex flex-col min-h-0 overflow-hidden">
                {/* VIEW 1: LIBRARIES LIST */}
                {view === "libraries" && (
                  <div className="h-full flex flex-col min-h-0">
                    {/* Search & Category Tabs */}
                    <div className="p-2.5 sm:p-3 border-b border-slate-800 space-y-2 shrink-0 bg-slate-900/30">
                      <div className="relative">
                        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 size-3.5 sm:size-4 text-slate-500" />
                        <Input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder={lang === "ar" ? "بحث في المكتبات (مثل Package_DIP, Connector, Resistor)..." : "Search libraries (e.g. DIP, Connector, Resistor)..."}
                          className="h-8 sm:h-9 ps-8 sm:ps-9 text-xs sm:text-sm bg-slate-900 border-slate-700 text-white placeholder:text-slate-500"
                        />
                      </div>

                      {/* Categories Pills */}
                      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
                        <button
                          onClick={() => setActiveCategory("all")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0 ${
                            activeCategory === "all"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          {lang === "ar" ? "الكل" : "All"} ({libraries.length})
                        </button>

                        <button
                          onClick={() => setActiveCategory("ic_packages")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0 flex items-center gap-1 ${
                            activeCategory === "ic_packages"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          <Cpu className="size-3" />
                          {lang === "ar" ? "الحزم والدارات (IC)" : "IC Packages"}
                        </button>

                        <button
                          onClick={() => setActiveCategory("connectors")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0 flex items-center gap-1 ${
                            activeCategory === "connectors"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          <Cable className="size-3" />
                          {lang === "ar" ? "الموصلات" : "Connectors"}
                        </button>

                        <button
                          onClick={() => setActiveCategory("passives")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0 flex items-center gap-1 ${
                            activeCategory === "passives"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          <Zap className="size-3" />
                          {lang === "ar" ? "المقاومات والمكثفات" : "Passives"}
                        </button>

                        <button
                          onClick={() => setActiveCategory("semiconductors")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0 flex items-center gap-1 ${
                            activeCategory === "semiconductors"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          <Microchip className="size-3" />
                          {lang === "ar" ? "الديودات والترانزستورات" : "Semiconductors"}
                        </button>

                        <button
                          onClick={() => setActiveCategory("switches")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0 flex items-center gap-1 ${
                            activeCategory === "switches"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          <Sliders className="size-3" />
                          {lang === "ar" ? "المفاتيح والمرحلات" : "Switches & Relays"}
                        </button>

                        <button
                          onClick={() => setActiveCategory("modules")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0 flex items-center gap-1 ${
                            activeCategory === "modules"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          <Radio className="size-3" />
                          {lang === "ar" ? "الوحدات واللوحات" : "Modules"}
                        </button>
                      </div>
                    </div>

                    {/* Libraries Grid */}
                    <ScrollArea className="flex-1 min-h-0">
                      <div className="p-2.5 sm:p-3 grid grid-cols-1 min-[440px]:grid-cols-2 lg:grid-cols-3 gap-2">
                        {filteredLibraries.map((libName) => {
                          const isIndexed = kicadFootprintLibrary.isLibraryIndexed(libName);
                          return (
                            <button
                              key={libName}
                              onClick={() => loadLibrary(libName)}
                              className="text-start p-2.5 sm:p-3 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-800/90 hover:border-blue-500/40 active:scale-[.99] transition flex items-center justify-between group shadow-sm"
                            >
                              <div className="flex flex-col min-w-0 me-2">
                                <div className="font-medium text-xs sm:text-sm font-mono text-slate-200 group-hover:text-blue-400 transition-colors truncate">
                                  {libName}
                                </div>
                                <div className="mt-1 text-[10px] text-slate-500 flex items-center gap-1">
                                  <span>{isIndexed ? (lang === "ar" ? "مفهرس محلياً" : "Indexed") : (lang === "ar" ? "انقر للتصفح" : "Tap to browse")}</span>
                                </div>
                              </div>
                              <ChevronRight className="size-4 text-slate-600 group-hover:text-blue-400 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180 transition-all shrink-0" />
                            </button>
                          );
                        })}

                        {loading && (
                          <div className="p-6 text-center text-xs text-slate-400 col-span-full flex items-center justify-center gap-2">
                            <Loader2 className="size-4 animate-spin text-blue-500" />
                            <span>{lang === "ar" ? "جاري تحميل قائمة المكتبات الرسمية..." : "Loading libraries…"}</span>
                          </div>
                        )}

                        {!loading && filteredLibraries.length === 0 && (
                          <div className="p-8 text-center text-xs text-slate-500 col-span-full">
                            {lang === "ar" ? "لا توجد مكتبات مطابقة لخيارات البحث" : "No libraries found matching search."}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {/* VIEW 2: FOOTPRINTS LIST */}
                {view === "footprints" && (
                  <div className="h-full flex flex-col min-h-0">
                    {/* Search & Navigation Bar */}
                    <div className="p-2.5 sm:p-3 border-b border-slate-800 flex items-center gap-2 shrink-0 bg-slate-900/40">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => setView("libraries")}
                        className="h-8 w-8 border-slate-700 hover:bg-slate-800 text-slate-300 shrink-0"
                        title={lang === "ar" ? "العودة للمكتبات" : "Back to libraries"}
                      >
                        <ArrowLeft className="size-4 rtl:rotate-180" />
                      </Button>

                      <div className="relative flex-1">
                        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 size-3.5 sm:size-4 text-slate-500" />
                        <Input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder={lang === "ar" ? "بحث في بصمات هذه المكتبة..." : "Search footprints in this library..."}
                          className="h-8 sm:h-9 ps-8 sm:ps-9 text-xs sm:text-sm bg-slate-900 border-slate-700 text-white placeholder:text-slate-500"
                          autoFocus
                        />
                      </div>

                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => loadLibrary(library)}
                        disabled={loadingLibrary}
                        className="h-8 w-8 border-slate-700 hover:bg-slate-800 text-slate-300 shrink-0"
                        title={lang === "ar" ? "إعادة تحديث" : "Refresh"}
                      >
                        <RefreshCw className={`size-3.5 ${loadingLibrary ? "animate-spin text-blue-400" : ""}`} />
                      </Button>
                    </div>

                    {/* Grid of Footprints */}
                    <ScrollArea className="flex-1 min-h-0">
                      <div className="p-2.5 sm:p-3">
                        {loadingLibrary ? (
                          <div className="p-12 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                            <Loader2 className="size-6 animate-spin text-blue-500" />
                            <span>{lang === "ar" ? "جاري جلب وفهرسة ملفات .kicad_mod..." : "Loading `.kicad_mod` files…"}</span>
                          </div>
                        ) : filteredFootprints.length === 0 ? (
                          <div className="p-12 text-center text-xs text-slate-500">
                            {lang === "ar" ? "لم يتم العثور على بصمات مطابقة" : "No footprints found."}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                            {filteredFootprints.map((e) => (
                              <FootprintThumbnailCard
                                key={e.path}
                                entry={e}
                                library={library}
                                actionLabel={selectionOnly ? (lang === "ar" ? "تعيين" : "Assign") : (lang === "ar" ? "استيراد" : "Import")}
                                onSelect={handleSelectFootprint}
                                onInspect={handleInspect}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {/* VIEW 3: SINGLE FOOTPRINT PREVIEW */}
                {view === "preview" && selected && (
                  <div className="h-full flex flex-col overflow-hidden min-h-0">
                    {/* Preview Navigation Header */}
                    <div className="p-2.5 sm:p-3 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-900/40 shrink-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => setView("footprints")}
                          className="h-8 w-8 border-slate-700 hover:bg-slate-800 text-slate-300 shrink-0"
                          title={lang === "ar" ? "العودة لقائمة البصمات" : "Back to footprints"}
                        >
                          <ArrowLeft className="size-4 rtl:rotate-180" />
                        </Button>
                        <div className="flex flex-col min-w-0">
                          <div className="font-mono text-xs sm:text-sm font-bold text-white truncate">
                            {selected.name}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">
                            {library || ("library" in selected ? (selected as any).library : "")}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                            classifyFootprintMountingType("GetRenderModel" in selected ? (selected as any).GetRenderModel() : selected) === "SMD"
                              ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          }`}
                        >
                          {classifyFootprintMountingType("GetRenderModel" in selected ? (selected as any).GetRenderModel() : selected)}
                        </span>
                      </div>
                    </div>

                    {/* Responsive Viewport */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-4 grid grid-cols-1 md:grid-cols-[1fr_320px] gap-3 sm:gap-4">
                      {/* Visual Stage */}
                      <div className="h-[220px] sm:h-[280px] md:h-full min-h-[200px] rounded-xl bg-slate-950 border border-slate-800 p-2 sm:p-4 flex items-center justify-center relative overflow-hidden shadow-inner">
                        <FootprintPreview footprint={selected} className="w-full h-full" />
                        <div className="absolute top-2 start-2 text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900/90 border border-slate-800 text-slate-300">
                          {(() => {
                            const b = nativeFootprintBounds(selected);
                            const w = Math.max(0, b.maxX - b.minX);
                            const h = Math.max(0, b.maxY - b.minY);
                            return `${w.toFixed(2)} × ${h.toFixed(2)} mm`;
                          })()}
                        </div>
                      </div>

                      {/* Details & Specs */}
                      <div className="flex flex-col justify-between border border-slate-800 rounded-xl bg-slate-900/60 p-3 sm:p-4 space-y-3 sm:space-y-4">
                        <div className="space-y-3">
                          <div>
                            <div className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">
                              {lang === "ar" ? "المواصفات الهندسية" : "Footprint Specs"}
                            </div>
                            <div className="font-mono text-xs sm:text-sm font-bold text-white mt-0.5 break-all">
                              {selected.name}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                              <div className="text-[10px] text-slate-400">{lang === "ar" ? "عدد الأرجل" : "Pad count"}</div>
                              <div className="text-xs sm:text-sm font-bold text-slate-200 mt-0.5 font-mono">
                                {selected && ("GetPads" in selected ? (selected as any).GetPads().length : selected.pads?.length ?? 0)}
                              </div>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                              <div className="text-[10px] text-slate-400">{lang === "ar" ? "نوع التركيب" : "Mounting"}</div>
                              <div className="text-xs sm:text-sm font-bold text-slate-200 mt-0.5">
                                {selected && classifyFootprintMountingType("GetRenderModel" in selected ? (selected as any).GetRenderModel() : selected)}
                              </div>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                              <div className="text-[10px] text-slate-400">{lang === "ar" ? "رسوم السلك سكرين" : "Graphics"}</div>
                              <div className="text-xs sm:text-sm font-bold text-slate-200 mt-0.5 font-mono">
                                {selected && ("GetGraphicalItems" in selected ? (selected as any).GetGraphicalItems().length : selected.graphics?.length ?? 0)}
                              </div>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                              <div className="text-[10px] text-slate-400">{lang === "ar" ? "نماذج 3D" : "3D Models"}</div>
                              <div className="text-xs sm:text-sm font-bold text-slate-200 mt-0.5 font-mono">
                                {selected && ("GetModels" in selected ? (selected as any).GetModels().length : selected.models?.length ?? 0)}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="space-y-2 pt-2 border-t border-slate-800">
                          <Button
                            size="lg"
                            className="w-full h-10 sm:h-11 text-xs sm:text-sm font-bold gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-900/20 active:scale-[0.99] transition-transform"
                            onClick={() => {
                              if (!selected) return;
                              const model = "GetRenderModel" in selected ? (selected as any).GetRenderModel() : selected;
                              if (!model.library && library) model.library = library;
                              if (selectionOnly) onSelect?.(model);
                              else onImport?.(model);
                            }}
                            disabled={!selected || loadingSelected}
                          >
                            <Download className="size-4" />
                            <span>
                              {selectionOnly
                                ? (lang === "ar" ? "تعيين هذه البصمة للمكون" : "Assign Footprint")
                                : (lang === "ar" ? "استيراد ووضع على اللوحة (PCB)" : "Import & Place on PCB")}
                            </span>
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full h-7 sm:h-8 text-xs text-slate-400 hover:text-slate-200"
                            onClick={() => setView("footprints")}
                          >
                            {lang === "ar" ? "العودة لقائمة البصمات" : "Back to footprints list"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Bar */}
        <div className="border-t border-slate-800 px-3.5 py-2.5 flex items-center justify-between gap-2 bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-2 flex-1">
            <input
              ref={fileRef}
              type="file"
              accept=".kicad_mod,.pretty,.kicad_pcb,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLocalFileSelect(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="flex-1 h-9 sm:h-10 gap-2 border-dashed border-2 border-slate-700 hover:bg-slate-800/60 bg-slate-900/80 text-slate-200"
              disabled={loading}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="size-3.5 sm:size-4 text-blue-500" />
              <span className="text-xs font-medium">
                {lang === "ar" ? "ملف محلي KiCad Footprints" : "Local KiCad Footprints File"}
              </span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-9 sm:h-10 text-xs px-3 gap-1.5 shrink-0 border-2 border-dashed border-slate-700 hover:bg-slate-800/60 bg-slate-900/80 text-slate-200"
              onClick={initialize}
              disabled={loading}
            >
              <RefreshCw className={`size-3.5 text-blue-500 ${loading ? "animate-spin" : ""}`} />
              <span className="font-medium">{lang === "ar" ? "تحديث" : "Refresh"}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
