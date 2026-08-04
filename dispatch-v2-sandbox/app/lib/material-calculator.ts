export type MaterialCategory =
  | "Mulch"
  | "Soil"
  | "Aggregate"
  | "Sand"
  | "Decorative Landscape Stone";

export type MaterialConversion = {
  category: MaterialCategory;
  name: string;
  handle: string | null;
  tonsPerYard: number | null;
  soldBy: "yard" | "ton";
};

export type MaterialConversionGroup = {
  category: MaterialCategory;
  materials: MaterialConversion[];
};

export const MATERIAL_CONVERSION_GROUPS: MaterialConversionGroup[] = [
  {
    category: "Mulch",
    materials: [
      { category: "Mulch", name: "Red Environmental Mulch", handle: "red-enviromental-mulch", tonsPerYard: null, soldBy: "yard" },
      { category: "Mulch", name: "Midnight Black Mulch", handle: "black-mulch", tonsPerYard: null, soldBy: "yard" },
      { category: "Mulch", name: "Cedar Mulch", handle: "cedar-mulch", tonsPerYard: null, soldBy: "yard" },
      { category: "Mulch", name: "Certified Playground Chips", handle: "certified-playground-chips", tonsPerYard: null, soldBy: "yard" },
      { category: "Mulch", name: "Deep Brown Mulch", handle: "deep-brown-mulch", tonsPerYard: null, soldBy: "yard" },
      { category: "Mulch", name: "Hemlock Mulch", handle: "hemlock-mulch", tonsPerYard: null, soldBy: "yard" },
      { category: "Mulch", name: "Hardwood Blend", handle: "hardwood-blend", tonsPerYard: null, soldBy: "yard" },
      { category: "Mulch", name: "Premium Blend Mulch", handle: "premium-blend-mulch", tonsPerYard: null, soldBy: "yard" },
      { category: "Mulch", name: "Cocoa Bean Mulch", handle: "cocoa-bean-mulch", tonsPerYard: null, soldBy: "yard" },
    ],
  },
  {
    category: "Soil",
    materials: [
      { category: "Soil", name: "Lawn & Garden Topsoil", handle: "top-soil", tonsPerYard: null, soldBy: "yard" },
      { category: "Soil", name: "Composted Soil", handle: "composted-soil", tonsPerYard: null, soldBy: "yard" },
      { category: "Soil", name: "Compost & Topsoil Mix", handle: "compost-topsoil-mix", tonsPerYard: null, soldBy: "yard" },
      { category: "Soil", name: "Custom Sand Soil Blend", handle: "custom-sand-soil-blend", tonsPerYard: null, soldBy: "yard" },
      { category: "Soil", name: "Premium Garden Mix", handle: "premium-garden-mix-1", tonsPerYard: null, soldBy: "yard" },
    ],
  },
  {
    category: "Aggregate",
    materials: [
      { category: "Aggregate", name: "Screenings", handle: "screenings", tonsPerYard: 1.3, soldBy: "ton" },
      { category: "Aggregate", name: "3/8\" Base", handle: "3-8-base", tonsPerYard: 1.3, soldBy: "ton" },
      { category: "Aggregate", name: "3/4\" Base", handle: "3-4-base", tonsPerYard: 1.2, soldBy: "ton" },
      { category: "Aggregate", name: "1.25\" Base", handle: "1-25-base", tonsPerYard: 1.26, soldBy: "ton" },
      { category: "Aggregate", name: "3/8 Chips", handle: "3-8-chips", tonsPerYard: 1, soldBy: "ton" },
      { category: "Aggregate", name: "#1 Stone", handle: "1-stone", tonsPerYard: 1.04, soldBy: "ton" },
      { category: "Aggregate", name: "#2 Stone", handle: "2-stone", tonsPerYard: 1.16, soldBy: "ton" },
      { category: "Aggregate", name: "#3 Stone", handle: "3-stone", tonsPerYard: 1.1, soldBy: "ton" },
      { category: "Aggregate", name: "4-8\" Stone", handle: "4-8-stone", tonsPerYard: 1.2, soldBy: "ton" },
    ],
  },
  {
    category: "Sand",
    materials: [
      { category: "Sand", name: "Ultra Fine Washed Sand", handle: "ultra-fine-washed-sand", tonsPerYard: 1.2, soldBy: "ton" },
      { category: "Sand", name: "Mason Sand", handle: "mason-sand", tonsPerYard: 1.2, soldBy: "ton" },
      { category: "Sand", name: "Coarse Torpedo Sand", handle: "coarse-torpedo-sand", tonsPerYard: 1.2, soldBy: "ton" },
      { category: "Sand", name: "Bedding Sand", handle: "bedding-sand", tonsPerYard: 1.3, soldBy: "ton" },
    ],
  },
  {
    category: "Decorative Landscape Stone",
    materials: [
      { category: "Decorative Landscape Stone", name: "Medium Alpine Stone", handle: "alpine-stone", tonsPerYard: 1.18, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Large Alpine Stone", handle: "alpine-stone", tonsPerYard: 1.04, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "#2 Landscape Stone", handle: "2-landscape-stone", tonsPerYard: 1.15, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "#3 Landscape Stone", handle: "3-washed-stone", tonsPerYard: 1.1, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Black Raven Sand", handle: "black-raven-sand", tonsPerYard: 1.18, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "3/8\" Black Raven", handle: "3-8-black-raven", tonsPerYard: 1.25, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "3/4\" Black Raven", handle: "3-4-black-raven", tonsPerYard: 1.1, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Decorative Black Raven", handle: "decorative-black-raven", tonsPerYard: 1.25, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Red Pepper", handle: null, tonsPerYard: null, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Medium Blue Basin", handle: "blue-basin", tonsPerYard: 1.14, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Large Blue Basin", handle: "blue-basin", tonsPerYard: 1.1, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Red Spardust", handle: "red-spardust", tonsPerYard: 1.2, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Gray Spardust", handle: "gray-spardust", tonsPerYard: 1.5, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Shooting Star Spardust", handle: "shooting-star-spardust", tonsPerYard: 1.5, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Pea Gravel", handle: "pea-gravel", tonsPerYard: 1.05, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Medium American Heritage", handle: "american-heritage", tonsPerYard: 1.14, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Large American Heritage", handle: "american-heritage", tonsPerYard: 1.18, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Medium Mississippi Stone", handle: "mississippi-stone", tonsPerYard: 1.14, soldBy: "ton" },
      { category: "Decorative Landscape Stone", name: "Large Mississippi Stone", handle: "mississippi-stone", tonsPerYard: 1.18, soldBy: "ton" },
    ],
  },
];

export function normalizeMaterialText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function allMaterialConversions() {
  return MATERIAL_CONVERSION_GROUPS.flatMap((group) => group.materials);
}

export function productPageUrl(handle?: string | null) {
  const cleanHandle = String(handle || "").trim();
  return cleanHandle ? `https://www.greenhillssupply.com/products/${cleanHandle}` : "";
}

export function findMaterialConversion(product?: { title?: string | null; handle?: string | null } | null) {
  const title = normalizeMaterialText(product?.title);
  const handle = normalizeMaterialText(product?.handle);
  const materials = allMaterialConversions();

  const sizeHint =
    title.includes("medium") ? "medium" : title.includes("large") ? "large" : "";

  if (handle) {
    const handleMatches = materials.filter((material) => normalizeMaterialText(material.handle) === handle);
    if (handleMatches.length === 1) return handleMatches[0];
    if (handleMatches.length > 1 && sizeHint) {
      const sized = handleMatches.find((material) => normalizeMaterialText(material.name).includes(sizeHint));
      if (sized) return sized;
    }
    if (handleMatches.length > 0) return handleMatches[0];
  }

  const exact = materials.find((material) => normalizeMaterialText(material.name) === title);
  if (exact) return exact;

  return (
    materials.find((material) => {
      const materialName = normalizeMaterialText(material.name);
      return title.includes(materialName) || materialName.includes(title);
    }) || null
  );
}

export function orderedMaterialConversionGroups(product?: { title?: string | null; handle?: string | null } | null) {
  const selected = findMaterialConversion(product);
  if (!selected) return MATERIAL_CONVERSION_GROUPS;
  const selectedIndex = MATERIAL_CONVERSION_GROUPS.findIndex((group) => group.category === selected.category);
  if (selectedIndex <= 0) return MATERIAL_CONVERSION_GROUPS;
  return [
    MATERIAL_CONVERSION_GROUPS[selectedIndex],
    ...MATERIAL_CONVERSION_GROUPS.slice(0, selectedIndex),
    ...MATERIAL_CONVERSION_GROUPS.slice(selectedIndex + 1),
  ];
}

export function calculateBaseCubicYards(input: {
  shape: "rectangle" | "circle" | "area";
  lengthFeet?: number;
  widthFeet?: number;
  diameterFeet?: number;
  areaValue?: number;
  areaUnit?: "square-feet" | "square-inches";
  depthInches?: number;
  manualYards?: number;
}) {
  const manualYards = Number(input.manualYards || 0);
  if (manualYards > 0) return manualYards;

  const depthInches = Number(input.depthInches || 0);
  if (input.shape === "circle") {
    const diameterFeet = Number(input.diameterFeet || 0);
    if (diameterFeet <= 0 || depthInches <= 0) return 0;
    return (Math.PI * diameterFeet * diameterFeet * depthInches) / 1296;
  }

  if (input.shape === "area") {
    const areaValue = Number(input.areaValue || 0);
    if (areaValue <= 0 || depthInches <= 0) return 0;
    const squareFeet = input.areaUnit === "square-inches" ? areaValue / 144 : areaValue;
    return (squareFeet * depthInches) / 324;
  }

  const lengthFeet = Number(input.lengthFeet || 0);
  const widthFeet = Number(input.widthFeet || 0);
  if (lengthFeet <= 0 || widthFeet <= 0 || depthInches <= 0) return 0;
  return (lengthFeet * widthFeet * depthInches) / 324;
}

export function calculateRecommendedCubicYards(baseYards: number, extraPercent: number) {
  return Math.max(0, baseYards) * (1 + Math.max(0, Number(extraPercent || 0)) / 100);
}

export function calculateOrderQuantity(recommendedYards: number, material: MaterialConversion | null) {
  if (!material || material.soldBy === "yard") return Math.ceil(Math.max(0, recommendedYards));
  return Math.ceil(Math.max(0, recommendedYards * Number(material.tonsPerYard || 1)));
}
